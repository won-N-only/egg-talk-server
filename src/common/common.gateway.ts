import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
  ConnectedSocket,
  MessageBody,
} from '@nestjs/websockets'
import { UseGuards } from '@nestjs/common'
import { JwtAuthWsGuard } from '../guards/jwt-auth.ws.guard'
// import { Server } from 'http';
import { Server, Socket } from 'socket.io'
import { Logger } from '@nestjs/common'
const logger = new Logger('ChatGateway')

import { CommonService } from './common.service'
import { lookup } from 'dns'
import { Types, ObjectId, Schema } from 'mongoose'

// @UseGuards(JwtAuthWsGuard)
@WebSocketGateway({ namespace: 'common' })
export class CommonGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer() server: Server

  constructor(private commonService: CommonService) {}

  // private connectedUsers: { [userId: string]: string } = {} // userId: socketId 형태로 변경
  private connectedUsers = new Map<string, Socket>() // userId(ObjectId) : socket 객체형태로 변경
  // private connectedSockets: { [socketId: string]: string } = {} // socketId: userId 형태로 변경
  private connectedSockets = new Map<string, string>() // socketId: userId 형태로 변경

  @SubscribeMessage('message')
  handleMessage(client: any, payload: any): string {
    return 'Hello world!'
  }

  // 클라이언트 연결 시 처리 로직
  handleConnection(@ConnectedSocket() client: Socket): void {}

  // 클라이언트 연결 해제 시 처리 로직
  async handleDisconnect(@ConnectedSocket() client: Socket) {
    // 유저가 종료되면 연결된 소켓에 해당 유저 종료했다고 알림
    const userId = this.connectedSockets.get(client.id)
    const friendIds = await this.commonService.sortfriend(userId)
    for (const friend of friendIds) {
      const friendSocket = this.connectedUsers.get(friend.toString())
      if (friendSocket) {
        friendSocket.emit('friendOffline', userId)
      }
    }

    // 연결된 클라이언트 삭제
    delete this.connectedSockets[client.id]
    delete this.connectedUsers[userId]
    logger.log(client.id, '연결이 끊겼습니다.')
  }
  @SubscribeMessage('decodeToken')
  async decodeToken(@ConnectedSocket() client: Socket) {
    try {
      const { userId } = client['user']
      // 현재 이 게이트웨이에 존재하는 모든 클라이언트를 식별할 수 있는 array 생성
      this.connectedUsers.set(userId, client)
      this.connectedSockets.set(client.id, userId)
      // 서버에 접속한 유저들에게 해당 유저가 온라인 되었다는 메세지를 보냄
      // 나와 친구인 사람들에게만 emit을 보내야함
      // 1. 나와 친구인 사람을 파악하기 위해서 내정보에서 가져옴
      const friendIds = await this.commonService.sortfriend(userId)
      // 2. 순서대로 emit을 보내야함 (내 친구가 현재 접속해있다면!)
      for (const friend of friendIds) {
        const friendSocket = this.connectedUsers.get(friend.toString())
        if (friendSocket) {
          friendSocket.emit('friendOnline', userId)
        }
      }
    } catch (error) {
      logger.error('토큰 파싱 오류 발생', error)
      client.disconnect()
    }
  }

  @SubscribeMessage('joinchat')
  async handleJoinRoom(
    client: Socket,
    payload: { newChatRoomId: string; userId: string },
  ) {
    // 1. 기존 채팅방 정보 가져오기

    const currentRooms = Array.from(client.rooms) // 현재 참여 중인 모든 방
    console.log(currentRooms, '현재 참여중인 모든 방')
    const currentChatRoomId = currentRooms.find(room => room !== client.id) // Socket ID 제외
    console.log(currentChatRoomId, '참여중인 채팅창이 있었다면 표시되어야함 !')
    console.log(payload)
    const { newChatRoomId, userId } = payload
    // 2. 기존 채팅방 연결 종료 (만약 있다면)
    if (currentChatRoomId) {
      client.leave(currentChatRoomId) // 기존 방 떠나기
    }

    // 3. 새 채팅방 참여
    client.join(newChatRoomId)
    console.log(newChatRoomId, '새롭게 참여할 채팅방 정보')

    const socketIdsInChat = (
      await this.server.in(newChatRoomId).fetchSockets()
    ).map(Socket => Socket.id)
    console.log(socketIdsInChat, '채팅방에 접속 중인 소켓 ID 목록:')
    // 4. 채팅 기록 불러오기 (필요하다면)
    const chatHistory = await this.commonService.getChatHistory(
      newChatRoomId,
      userId,
    )
    client.emit('chatHistory', chatHistory)
  }

  @SubscribeMessage('send')
  async handleSendMessage(
    @ConnectedSocket() client: Socket,
    @MessageBody()
    payload: {
      userId: string
      chatRoomId: string
      message: string
      receiverId: string
    },
  ) {
    try {
      const { chatRoomId, message, userId, receiverId } = payload

      // 상대방이 채팅방에 참여 중인지 확인
      const receiverSocket = (
        await this.server.in(chatRoomId).fetchSockets()
      ).find(socket => socket.data.userId === receiverId)

      const newChat = await this.commonService.sendMessage(
        userId,
        chatRoomId,
        message,
        !!receiverSocket,
      ) // isReceiverOnline 전달
      // 메시지 전송
      if (receiverSocket) {
        this.server.to(chatRoomId).emit('message', newChat) // 상대방이 (온라인 상태 + 채팅방 참여) 일때 메시지 전송
      } else {
        if (receiverId in this.connectedUsers) {
          const receiverSocketId = this.connectedUsers[receiverId]
          this.server
            .to(receiverSocketId)
            .emit('newMessageNotification', chatRoomId)
        }
        // 유저 정보에서 "newNotification": bool 부분만 바꿔주면됌
        await this.commonService.changeNotice(receiverId)
      }

      // 1. recieverId에 대응 하는 socket ID 가 connectClient에 존재하는지 확인
      // 2. (존재하는경우)
      //                1) 상대방이 room에 join 한경우         emit("message")
      //                2) 상대방이 room에 join 하지 않은 경우   emit("online_notice_message")
      //
      // 3. (존재하지 않는 경우)
      //                3) 해당 socketID(친구)에게           db에 꽂아야함"offline_notice_message")
    } catch (error) {
      logger.error('메시지 전송 실패:', error)
      client.emit('error', '메시지 전송에 실패했습니다.')
    }
  }
}
