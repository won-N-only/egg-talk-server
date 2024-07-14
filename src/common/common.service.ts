import { Inject, Injectable } from '@nestjs/common'
import { AcceptFriend, AddFriendDto } from './dto/request/notification.dto'
import { UsersRepository } from '../users/users.repository'
import { Notification } from '../entities/notification.entity'
import { ObjectId, Types } from 'mongoose'
import { Chat } from '../entities/chat.entity'
import { User } from '../entities/user.entity'
import { Server, Socket } from 'socket.io'
import { CommonRepository } from './common.repository'
import { CACHE_MANAGER } from '@nestjs/cache-manager'
import { Cache } from 'cache-manager'
import Redis from 'ioredis'
import { Cron, CronExpression} from '@nestjs/schedule'
import { ChatRoom } from 'src/entities/chat-room.entity'
import { timestamp } from 'rxjs'

@Injectable()
export class CommonService {
  private redisClient: Redis
  constructor(
    private readonly commonRepository: CommonRepository,
    private readonly usersRepository: UsersRepository,
    
    @Inject(CACHE_MANAGER) private cacheManager: Cache,){
      this.redisClient = (this.cacheManager as any).store.getClient();
    }

  private server: Server
  // private connectedUsers = new Map<string, >() // userId: Socket
  private connectedSockets = new Map<string, Socket>() // socketId: Socket
  generateAnonymousNickname(): string {
    const adjectives = ['행복한', '즐거운', '신나는', '활기찬', '유쾌한']
    const nouns = ['고양이', '강아지', '토끼', '곰', '펭귄']

    const randomAdjective =
      adjectives[Math.floor(Math.random() * adjectives.length)]
    const randomNoun = nouns[Math.floor(Math.random() * nouns.length)]
    const randomNumber = Math.floor(Math.random() * 1000) // 0~999 사이의 난수

    return `${randomAdjective} ${randomNoun}#${randomNumber}`
  }

  setServer(server: Server) {
    this.server = server
  }

  async getSocketByUserId(nickname: string): Promise<Socket> {
    const socketId = await this.cacheManager.get<string>(
      `common:user:${nickname}`,
    )
    if (socketId) {
      return this.connectedSockets.get(socketId)
    }
    return null
  }

  async addUser(nickname: string, socket: Socket): Promise<void> {
    await this.cacheManager.set(`common:user:${nickname}`, socket.id)
    this.connectedSockets.set(socket.id, socket)
  }

  async removeUser(nickname: string, socketId: string): Promise<void> {
    await this.cacheManager.del(`common:user:${nickname}`)
    this.connectedSockets.delete(socketId)
  }

  // async getChatHistory(chatRoomId: string): Promise<Chat[]> {
  //   // 1. ChatRoom ObjectId로 변환
  //   const chatRoomIdObj = new Types.ObjectId(chatRoomId)

  //   const chatRoom =
  //     await this.commonRepository.getChatRoomMessage(chatRoomIdObj)
  //   console.log('chatroom populate result: ', chatRoom.chats)
  //   return chatRoom.chats as unknown as Chat[]
  // }

  // Redis 버전
  async getChatHistory(chatRoomId: string): Promise<Chat[]> {
    const messageIds = await this.redisClient.hkeys('chatHistory');
    const filteredIds = messageIds.filter(id => id.startsWith(`${chatRoomId}:`));
  
    if (filteredIds.length === 0) {
      // Redis에 해당 채팅방 메시지가 없으면 DB에서 가져와 Redis에 저장
      const dbChatHistory = await this.commonRepository.getChatHistoryFromDatabase(chatRoomId);
      const dbChats = dbChatHistory.chats as unknown as Chat[];
  
      const pipeline = this.redisClient.pipeline();
      for (const chat of dbChats) {
        const messageId = Date.now() + Math.random(); // 랜덤 값 추가하여 중복 방지
        pipeline.hset('chatHistory', `${chatRoomId}:${messageId}`, JSON.stringify(chat));
      }
      await pipeline.exec();
  
      return dbChats;
    }
  
    const messages = await this.redisClient.hmget('chatHistory', ...filteredIds);
    return messages.map(message => {
      const parsedMessage = JSON.parse(message);
      parsedMessage.chatRoomId = new Types.ObjectId(parsedMessage.chatRoomId); // ObjectId로 변환
      return parsedMessage as Chat;
    });
  }

  // async sendMessage(
  //   senderNickName: string,
  //   chatRoomId: string,
  //   message: string,
  //   isReceiverOnline: boolean,
  // ): Promise<Chat> {
  //   try {
  //     //DTO
  //     const newChat = await this.commonRepository.saveMessagetoChatRoom(
  //       senderNickName,
  //       message,
  //       chatRoomId,
  //       isReceiverOnline,
  //     )
  //     return newChat
  //   } catch (error) {
  //     console.error('메시지 저장 실패:', error)
  //     throw error
  //   }
  // }

  // Redis 버전
  async sendMessage(
    senderNickName: string,
    chatRoomId: string,
    message: string,
    isReceiverOnline: boolean,
  ): Promise<Chat> {
      const newChat = new Chat();
      newChat.sender = senderNickName
      newChat.message = message;
      newChat.chatRoomId = new Types.ObjectId(chatRoomId);
      const messageId = Date.now();
      
      // Redis Hash에 메세지 추가
      await this.redisClient.hset(
        'chatHistory',
        `${chatRoomId}:${messageId}`,
        JSON.stringify({ ...newChat, timestamp: messageId }) // chatRoomId는 ObjectId 그대로 유지
      );
      // await this.redisClient.rpush(`chatHistory:${chatRoomId}`, JSON.stringify(newChat))
      // ChatRoom의 isRead 업데이트
      await this.commonRepository.updateChatRoomIsRead(chatRoomId, isReceiverOnline);
      console.log("service 까지는 들어옵니다")
      return newChat
    }

    @Cron(CronExpression.EVERY_30_SECONDS) 
    async saveChatHistoryToDataBase() {
      console.log("Cron 정상작동합니다!!!!!!");
    
      const messageIds = await this.redisClient.hkeys('chatHistory');
      const chatRoomMessages = {};
      for (const messageId of messageIds) {
        const [chatRoomId, _] = messageId.split(':');
        chatRoomMessages[chatRoomId] = chatRoomMessages[chatRoomId] || [];
        chatRoomMessages[chatRoomId].push(messageId);
      }
    
      for (const chatRoomId in chatRoomMessages) {
        const messages = await this.redisClient.hmget('chatHistory', ...chatRoomMessages[chatRoomId]);
    
        if (messages.length > 0) {
          const chatEntities = messages.map(message => JSON.parse(message) as Chat & { timestamp: number })
            .sort((a, b) => a.timestamp - b.timestamp)
            .filter((chat : any) => !chat._id);

          
          console.log(chatEntities, "제대로 들어오는지 확인")
          // MongoDB에 저장 (chatRoomId를 ObjectId로 변환)
          if (chatEntities.length > 0) {
            try {
              await this.commonRepository.saveChatHistoryToMongo(
                new Types.ObjectId(chatRoomId),
                chatEntities
              );
    
              // MongoDB 저장 성공 후 Redis에서 메시지 삭제
              await this.redisClient.hdel('chatHistory', ...chatRoomMessages[chatRoomId]);
            } catch (error) {
              console.error('Error saving chat history:', error);
              // 에러 처리 (예: 재시도 로직 추가)
            }
          }
        }
      }
    }
    
    
  
  async changeNotice(userId: string) {
    try {
      await this.commonRepository.setNewNotification(userId)
    } catch (error) {
      console.error('알림이 전송되지 않았습니다.', error)
      throw error
    }
  }

  async sortFriend(userId: string) {
    // 유저 정보를 조회하여 친구목록 화인
    // 내 친구에게만 알림 보내면됨
    try {
      const friendIds = await this.commonRepository.getFriendIds(userId)
      return friendIds?.friends.map(elem => elem.friend)
    } catch (error) {
      throw error
    }
  }

  async getNotifications(nickname: String): Promise<Notification[]> {
    return this.commonRepository.getNotification(nickname)
  }

  async markNotification(data: AddFriendDto): Promise<Notification> {
    const { userNickname, friendNickname } = data
    if (userNickname == friendNickname)
      throw new Error(`자기자신은 등록 안됩니다`)

    const user = await this.usersRepository.findOne(userNickname)
    if (user.friends.some(f => f.friend == friendNickname))
      throw new Error(`이미 친구에용.`)

    return await this.commonRepository.markNotification(data)
  }

  async getFriends(nickname: string): Promise<ObjectId[]> {
    return await this.commonRepository.getFriends(nickname)
  }

  async acceptFriend(data: AcceptFriend): Promise<User> {
    const { userNickname, friendNickname } = data
    const user = await this.usersRepository.findOne(userNickname)
    if (user.friends.some(f => f.friend == friendNickname))
      throw new Error(`이미 친구에용.`)

    return await this.commonRepository.acceptFriend(data)
  }

  async newMessage(receiverNickname: string, userNickname: string) {
    try {
      this.commonRepository.changeNewMessage(receiverNickname, userNickname)
    } catch (error) {
      throw error
    }
  }

  async readMessage(receiverNickname: string, userNickname: string) {
    try {
      this.commonRepository.changeReadMessage(receiverNickname, userNickname)
    } catch (error) {
      throw error
    }
  }
}
