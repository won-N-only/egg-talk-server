import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets'
import { Logger, UseGuards } from '@nestjs/common'
import { JwtAuthWsGuard } from '../guards/jwt-auth.ws.guard'
import { Server, Socket } from 'socket.io'
import { CommonService } from './common.service'
import { AcceptFriend, AddFriendDto } from './dto/request/notification.dto'
import { UsersService } from '../users/users.service'
import { joinChatDto, sendMessageDto } from './dto/request/chat.dto'

const logger = new Logger('ChatGateway')

const anonymousNicknames = new Map<string, string>()

@UseGuards(JwtAuthWsGuard)
@WebSocketGateway({
  namespace: 'common',
  cors: {
    origin: [
      'http://localhost:3000',
      'https://egg-signal-app.syeong.link',
      'https://temp-git-main-hyeong1s-projects.vercel.app',
    ],
    methods: ['GET', 'POST'],
    allowedHeaders: ['Content-Type'],
    credentials: true,
  },
})
export class CommonGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer() server: Server

  constructor(
    private commonService: CommonService,
    private usersService: UsersService,
  ) {}

  afterInit(server: Server) {
    this.commonService.setServer(server)
  }

  // 클라이언트 연결 시 처리 로직
  handleConnection(@ConnectedSocket() client: Socket): void {}

  // 클라이언트 연결 해제 시 처리 로직
  async handleDisconnect(@ConnectedSocket() client: Socket) {
    // 유저가 종료되면 연결된 소켓에 해당 유저 종료했다고 알림
    const nickname = client['user']?.nickname // 올바른 코드
    const friendIds = await this.commonService.sortFriend(nickname)
    // console.log(friendIds)
    if (friendIds) {
      for (const friend of friendIds) {
        const friendSocket = await this.commonService.getSocketByUserId(
          friend.toString(),
        )
        if (friendSocket) {
          friendSocket.emit('friendOffline', nickname)
        }
      }
    }
    // 연결된 클라이언트 삭제
    this.commonService.removeUser(nickname, client.id)
    // 연결된 익명 닉네임 삭제
    anonymousNicknames.delete(client.id)
    logger.log(client.id, '연결이 끊겼습니다.')
  }

  @SubscribeMessage('friendStat')
  async friendStat(@ConnectedSocket() client: Socket) {
    try {
      const nickname = client['user'].nickname
      // const nickname = 'jinYong'
      const friendIds = await this.commonService.sortFriend(nickname)
      // const friendStat = new Map<string, boolean>();
      const friendStat: Array<{ [key: string]: boolean }> = []

      if (friendIds.length > 0) {
        for (const friend of friendIds) {
          const friendSocket = this.commonService.getSocketByUserId(friend)
          if (friendSocket) {
            // 친구가 로그인 되어있다면 { 친구이름 : 참 } 형태로 저장
            friendStat.push({ [friend]: true })
          } else {
            // 친구가 로그오프로 되어있다면 { 친구이름 : 거짓 } 형태로 저장
            friendStat.push({ [friend]: false })
          }
        }
      }

      client.emit('friendStat', friendStat)
    } catch (error) {
      logger.error('친구 상태 정보 조회 실패', error)
      client.disconnect()
    }
  }

  // 로그인할때 오는 요청메세지
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
        const friendSocket = await this.commonService.getSocketByUserId(
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

  @SubscribeMessage('joinChat')
  async handleJoinRoom(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: joinChatDto, // nickName == userId
  ) {
    const { newChatRoomId, friendName } = payload
    const nickname = client['user'].nickname
    // 1. 기존 채팅방 정보 가져오기
    const currentRooms = Array.from(client.rooms) // 현재 참여 중인 모든 방
    const currentChatRoomId = currentRooms.find(room => room !== client.id) // Socket ID 제외
    // 2. 기존 채팅방 연결 종료 (만약 있다면)
    if (currentChatRoomId) {
      client.leave(currentChatRoomId) // 기존 방 떠나기
    }

    // 3. 새 채팅방 참여
    client.join(newChatRoomId)

    // 4. 채팅 기록 불러오기 (필요하다면)
    const chatHistory = await this.commonService.getChatHistory(newChatRoomId)
    await this.commonService.readMessage(friendName, nickname)
    client.emit('chatHistory', chatHistory)
  }

  @SubscribeMessage('closeChat')
  async closeChat(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { chatRoomId: string },
  ) {
    try {
      const { chatRoomId } = payload
      client.leave(chatRoomId)
    } catch (error) {
      logger.error('채팅방 떠나기 오류', error)
    }
  }

  @SubscribeMessage('sendMessage')
  async handleSendMessage(
    @ConnectedSocket() client: Socket,
    @MessageBody()
    payload : sendMessageDto,
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
        const receiverSocketId = await this.commonService
          .getSocketByUserId(receiverNickname)
          .then(sock => sock.id)
        if (receiverSocketId) {
          this.server
            .to(receiverSocketId)
            .emit('newMessageNotification', chatRoomId)
        }
        // 유저 정보에서 "newNotification": bool 부분만 바꿔주면됌
        await this.commonService.changeNotice(receiverNickname)
        await this.commonService.newMessage(receiverNickname, userNickname)
      }

      // 1. receiverId에 대응 하는 socket ID 가 connectClient에 존재하는지 확인
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

  // 누군가 홈화면에서 채팅을 보냈을때
  @SubscribeMessage('homeChat')
  async handleHomeChat(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { message: string },
  ) {
    try {
      let nickname = anonymousNicknames.get(client.id)
      const { message } = payload
      if (!nickname) {
        // 닉네임이 없으면 새로 생성
        nickname = this.commonService.generateAnonymousNickname()
        anonymousNicknames.set(client.id, nickname)
      }
      this.server.emit('homeChat', { message, nickname })
      // console.log(nickname,"께서 보내신 메세지입니다.", message );
    } catch (error) {
      console.error('HomeChat 수신 오류', error)
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
      const friendSocket = await this.commonService.getSocketByUserId(
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
    @MessageBody() data: AcceptFriend,
  ): Promise<void> {
    try {
      const { friendNickname } = data
      const updatedUser = await this.commonService.acceptFriend(data)
      client.emit('resAcceptFriend', updatedUser)
      const friend = await this.usersService.findOne(friendNickname)
      const friendSocket =
        await this.commonService.getSocketByUserId(friendNickname)
      friendSocket?.emit('friendRequestAccepted', friend)
    } catch (error) {
      client.emit('resAcceptFriendError', error.message)
    }
  }
}
