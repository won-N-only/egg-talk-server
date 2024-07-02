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
import { Server, Socket } from 'socket.io'
import { Logger } from '@nestjs/common'
const logger = new Logger('ChatGateway')
import { CommonService } from './common.service'
import { Types } from 'mongoose'
import { AddFriendDto } from './dto/request/notification.dto'

@UseGuards(JwtAuthWsGuard)
@WebSocketGateway({ namespace: 'common' })
export class CommonGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer() server: Server

  constructor(private commonService: CommonService) {
    this.commonService.setServer(this.server)
  }

  // 클라이언트 연결 시 처리 로직
  async handleConnection(@ConnectedSocket() client: Socket) {
    const nickname = client['user'].nickname;
    // const nickname = 'jinyong'
    const friendIds = await this.commonService.sortFriend(nickname)
    // const friendStat = new Map<string, boolean>();
    const friendStat: Array<{ [key: string]: boolean }> = [];

    for (const friend of friendIds) {
      const friendSocket = this.commonService.getSocketByUserId(friend);
      if (friendSocket) {
        // 친구가 로그인 되어있다면 { 친구이름 : 참 } 형태로 저장
        friendStat.push({ [friend]: true }); 
      } else {
        // 친구가 로그오프로 되어있다면 { 친구이름 : 거짓 } 형태로 저장
        friendStat.push({ [friend]: false }); 
      }
    }
    client.emit('friendStat', friendStat);
  }

  // 클라이언트 연결 해제 시 처리 로직
  async handleDisconnect(@ConnectedSocket() client: Socket) {
    // 유저가 종료되면 연결된 소켓에 해당 유저 종료했다고 알림
    const nickname = client['user'].nickname // 올바른 코드
    const friendIds = await this.commonService.sortFriend(nickname)
    for (const friend of friendIds) {
      const friendSocket = this.commonService.getSocketByUserId(
        friend.toString(),
      )
      if (friendSocket) {
        friendSocket.emit('friendOffline', nickname)
      }
    }
    // 연결된 클라이언트 삭제
    this.commonService.removeUser(nickname, client.id)
    logger.log(client.id, '연결이 끊겼습니다.')
  }

  @SubscribeMessage('serverCertificate')
  async serverCertificate(@ConnectedSocket() client: Socket) {
    try {
      const { nickname } = client['user']
      // 현재 이 게이트웨이에 존재하는 모든 클라이언트를 식별할 수 있는 array 생성
      this.commonService.addUser(nickname, client)
      // 서버에 접속한 유저들에게 해당 유저가 온라인 되었다는 메세지를 보냄
      // 나와 친구인 사람들에게만 emit을 보내야함
      // 1. 나와 친구인 사람을 파악하기 위해서 내정보에서 가져옴
      const friendIds = await this.commonService.sortFriend(nickname)
      // 2. 순서대로 emit을 보내야함 (내 친구가 현재 접속해있다면!)
      for (const friend of friendIds) {
        const friendSocket = this.commonService.getSocketByUserId(
          friend.toString(),
        )
        if (friendSocket) {
          friendSocket.emit('friendOnline', nickname)
        }
      }
    } catch (error) {
      logger.error('파싱 오류 발생', error)
      client.disconnect()
    }
  }

  @SubscribeMessage('joinchat')
  async handleJoinRoom(
    client: Socket,
    payload: { newChatRoomId: string }, // nickName == userId
  ) {
    const { newChatRoomId } = payload
    const chatRoomId = newChatRoomId
    // 1. 기존 채팅방 정보 가져오기

    const currentRooms = Array.from(client.rooms) // 현재 참여 중인 모든 방
    const currentChatRoomId = currentRooms.find(room => room !== client.id) // Socket ID 제외
    // 2. 기존 채팅방 연결 종료 (만약 있다면)
    if (currentChatRoomId) {
      client.leave(currentChatRoomId) // 기존 방 떠나기
    }

    // 3. 새 채팅방 참여
    client.join(chatRoomId)

    // 4. 채팅 기록 불러오기 (필요하다면)
    const chatHistory = await this.commonService.getChatHistory(chatRoomId)
    client.emit('chatHistory', chatHistory)
  }

  @SubscribeMessage('closeChat')
  async closeChat(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { chatRoomdId: string },
  ) {
    try {
      const { chatRoomdId } = payload
      client.leave(chatRoomdId)
    } catch (error) {
      logger.error('채팅방 떠나기 오류', error)
    }
  }

  @SubscribeMessage('sendMessage')
  async handleSendMessage(
    @ConnectedSocket() client: Socket,
    @MessageBody()
    payload: {
      userNickname: string
      chatRoomId: string
      message: string
      receiverNickname: string
    },
  ) {
    try {
      const { chatRoomId, message, userNickname, receiverNickname } = payload

      // 상대방이 채팅방에 참여 중인지 확인
      const receiverSocket = (
        await this.server.in(chatRoomId).fetchSockets()
      ).find(client => client['user'].nickname === receiverNickname)

      /**DTO */
      const newChat = await this.commonService.sendMessage(
        userNickname,
        chatRoomId,
        message,
        !!receiverSocket,
      ) // isReceiverOnline 전달
      // 메시지 전송
      if (receiverSocket) {
        this.server.to(chatRoomId).emit('message', newChat) // 상대방이 (온라인 상태 + 채팅방 참여) 일때 메시지 전송
      } else {
        const receiverSocketId =
          this.commonService.getSocketByUserId(receiverNickname)?.id
        if (receiverSocketId) {
          this.server
            .to(receiverSocketId)
            .emit('newMessageNotification', chatRoomId)
        }
        // 유저 정보에서 "newNotification": bool 부분만 바꿔주면됌
        await this.commonService.changeNotice(receiverNickname)
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

  @SubscribeMessage('reqGetNotifications')
  async handleGetNotifications(
    @ConnectedSocket() client: Socket,
  ): Promise<void> {
    try {
      const nickname = client['user'].nickname
      const notifications = await this.commonService.getNotifications(nickname)
      client.emit('resGetNotifications', notifications)
    } catch (error) {
      client.emit('resGetNotificationsError', error.message)
    }
  }

  @SubscribeMessage('reqGetFriends')
  async handleGetFriendList(@ConnectedSocket() client: Socket): Promise<void> {
    try {
      const nickname = client['user'].nickname
      const friends = await this.commonService.getFriends(nickname)
      client.emit('resGetFriends', friends)
    } catch (error) {
      client.emit('resGetFriendsError', error.message)
    }
  }

  @SubscribeMessage('reqRequestFriend')
  async handleRequestFriend(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: AddFriendDto,
  ): Promise<void> {
    try {
      const friendSocket = this.commonService.getSocketByUserId(
        data.friendNickname,
      )
      if (friendSocket) friendSocket.emit('newFriendRequest', data)

      await this.commonService.markNotification(data)
    } catch (error) {
      client.emit('reqRequestFriendError', error.message)
    }
  }

  @SubscribeMessage('reqAcceptFriend')
  async handleAcceptFriend(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: AddFriendDto,
  ): Promise<void> {
    try {
      const updatedUser = await this.commonService.acceptFriend(data)
      client.emit('resAcceptFriend', updatedUser)
    } catch (error) {
      client.emit('resAcceptFriendError', error.message)
    }
  }
}
