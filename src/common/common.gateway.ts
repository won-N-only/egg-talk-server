import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
  ConnectedSocket,
  MessageBody,
} from '@nestjs/websockets';
import { UseGuards } from '@nestjs/common'
import { JwtAuthWsGuard } from '../guards/jwt-auth.ws.guard'
// import { Server } from 'http';
import { Server, Socket} from 'socket.io';
import { Logger } from "@nestjs/common";
const logger = new Logger('ChatGateway');

import { CommonService } from './common.service';

// @UseGuards(JwtAuthWsGuard)
@WebSocketGateway({ namespace: 'common' })
export class CommonGateway implements OnGatewayConnection, OnGatewayDisconnect{
  @WebSocketServer() server : Server;

  constructor(private commonService: CommonService) {}

  connectedClients : {[socketId : string]: boolean} = {} ;
  // private connectedUsers: { [userId: string]: Socket[] } = {}; // userId (string)로 변경

  @SubscribeMessage('message')
  handleMessage(client: any, payload: any): string {
    return 'Hello world!'
  }

  // 클라이언트 연결 시 처리 로직
  handleConnection(client : Socket): void {
    // 1. 현재 이 게이트웨이에 존재하는 모든 클라이언트를 식별할 수 있는 array 생성
    const userId = client.handshake.query.userId as string;
    if (this.connectedClients[client.id]){
      client.disconnect(true);
      logger.log(client.id, "연결이 끊겼습니다.");
      return;
    }
    this.connectedClients[client.id] = true;
    client.data.userId = userId;
    const soketuser = client.data.userId
    console.log(soketuser, "socket에 넣은 유저 아이디");
    logger.log(client.id, "연결되었습니다.");
  };

  // 클라이언트 연결 해제 시 처리 로직
  handleDisconnect(client: Socket): void {
      if( this.connectedClients[client.id]){
        // 연결된 클라이언트 목록에서 삭제
        delete this.connectedClients[client.id];
        delete client.data.userId;
        logger.log(client.id, "연결이 끊겼습니다.");
    }
  };


  @SubscribeMessage('joinchat')
  async handleJoinRoom(client: Socket, payload: { newChatRoomId: string, userId: string }) {
    // 1. 기존 채팅방 정보 가져오기
    const currentRooms = Array.from(client.rooms); // 현재 참여 중인 모든 방
    console.log(currentRooms, "현재 참여중인 모든 방");
    const currentChatRoomId = currentRooms.find(room => room !== client.id); // Socket ID 제외
    console.log(currentChatRoomId, "참여중인 채팅창이 있었다면 표시되어야함 !");
    const { newChatRoomId, userId}  = payload;
    // 2. 기존 채팅방 연결 종료 (만약 있다면)
    if (currentChatRoomId) {
      client.leave(currentChatRoomId); // 기존 방 떠나기
    }
  
    // 3. 새 채팅방 참여
    client.join(newChatRoomId);
    console.log(newChatRoomId, "새롭게 참여할 채팅방 정보");

    const socketIdsInChat = (await this.server.in(newChatRoomId).fetchSockets()).map(Socket => Socket.id);
    console.log(socketIdsInChat, "채팅방에 접속 중인 소켓 ID 목록:");
    // 4. 채팅 기록 불러오기 (필요하다면)
    const chatHistory = await this.commonService.getChatHistory(newChatRoomId, userId);
    client.emit('chatHistory', chatHistory);
  }


  @SubscribeMessage('send')
  async handleSendMessage(
    client: Socket,
    payload: { userId: string; chatRoomId: string; message: string; receiverId: string }
  ) {
    try {
      const { chatRoomId, message, userId, receiverId } = payload;

      // 상대방이 채팅방에 참여 중인지 확인
      const receiverSocket = (await this.server.in(chatRoomId).fetchSockets()).find(
        (socket) => socket.data.userId === receiverId
      );

      const newChat = await this.commonService.sendMessage(userId, chatRoomId, message, !!receiverSocket); // isReceiverOnline 전달
      // 메시지 전송
      if(receiverSocket){
        this.server.to(chatRoomId).emit('message', newChat); // 상대방이 온라인 상태일 때만 메시지 전송
      }
    } catch (error) {
      logger.error('메시지 전송 실패:', error);
      client.emit('error', '메시지 전송에 실패했습니다.');
    }
  }
}
