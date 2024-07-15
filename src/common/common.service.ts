import { Inject, Injectable } from '@nestjs/common'
import { AcceptFriend, AddFriendDto } from './dto/request/notification.dto'
import { UsersRepository } from '../users/users.repository'
import { Notification } from '../entities/notification.entity'
import { ObjectId, Types, Model } from 'mongoose'
import { Chat, ChatWithMetadata } from '../entities/chat.entity'
import { User } from '../entities/user.entity'
import { Server, Socket } from 'socket.io'
import { CommonRepository } from './common.repository'
import { CACHE_MANAGER } from '@nestjs/cache-manager'
import { Cache } from 'cache-manager'
import { Redis } from 'ioredis'
import { Cron, CronExpression} from '@nestjs/schedule'
import { ChatRoom } from 'src/entities/chat-room.entity'
import { timestamp } from 'rxjs'
import { InjectModel } from '@nestjs/mongoose'

@Injectable()
export class CommonService {
  private redisClient: Redis
  constructor(
    private readonly commonRepository: CommonRepository,
    private readonly usersRepository: UsersRepository,
    @InjectModel(Chat.name) private chatModel: Model<Chat>,

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
    const messages = await this.redisClient.zrange(`chatHistorySorted:${chatRoomId}`, 0, -1); // Sorted Set에서 메시지 가져오기
    if (messages.length === 0) {
      // Redis에 해당 채팅방 메시지가 없으면 DB에서 가져와 Redis에 저장 (Sorted Set 사용)
      const dbChatHistory = await this.commonRepository.getChatHistoryFromDatabase(chatRoomId);
      if (!dbChatHistory) {
        console.error(`Chat history not found in DB for chatRoomId: ${chatRoomId}`);
        return [];
      }
  
      const dbChats = dbChatHistory.chats as unknown as Chat[];
      const pipeline = this.redisClient.pipeline();
      for (const chat of dbChats) {
        const messageId = await this.redisClient.incr(`chatHistoryNextId:${chatRoomId}`); // messageId 증가
        const score = chat.timestamp ? new Date(chat.timestamp).getTime() : Date.now(); // DB에서 가져온 메시지에 timestamp가 없을 경우 현재 시간 사용
        pipeline.zadd(`chatHistorySorted:${chatRoomId}`, score, JSON.stringify({ ...chat, messageId }));
      }
      await pipeline.exec();
      return dbChats;
    }
    return messages.map(message => JSON.parse(message) as Chat); // 메시지 파싱
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
    const newChat = new this.chatModel({
      sender: senderNickName,
      message,
      chatRoomId: new Types.ObjectId(chatRoomId),
      timestamp: new Date(),
    });

    const messageId = await this.redisClient.incr(`chatHistoryNextId:${chatRoomId}`);
    await this.redisClient.zadd(
      `chatHistorySorted:${chatRoomId}`,
      newChat.timestamp.getTime(),
      JSON.stringify({sender:senderNickName,message,chatRoomId})
    );

    await this.commonRepository.updateChatRoomIsRead(chatRoomId, isReceiverOnline);
    await newChat.save();
    return newChat;
  }
  
  
  @Cron(CronExpression.EVERY_30_SECONDS)
  async saveChatHistoryToDataBase() {
    console.log("Cron 정상작동합니다!!!!!!");
  
    const chatRoomKeys = await this.redisClient.keys("chatHistorySorted:*");
  
    for (const chatRoomKey of chatRoomKeys) {
      const chatRoomId = chatRoomKey.split(":")[1];
  
      const messagesWithScores = await this.redisClient.zrange(
        chatRoomKey,
        0,
        -1,
        "WITHSCORES"
      );
      const messages: [string, number][] = [];
  
      // score를 숫자로 변환하며 messages 배열 생성
      for (let i = 0; i < messagesWithScores.length; i += 2) {
        const message = messagesWithScores[i];
        const score = parseInt(messagesWithScores[i + 1], 10); // score를 숫자로 변환
        if (!isNaN(score)) {
          messages.push([message, score]);
        } else {
          console.error(`Invalid score: ${messagesWithScores[i + 1]}`);
        }
      }
  
      if (messages.length > 0) {
        const chatEntities: ChatWithMetadata[] = messages.map(([message, score]) => {
          try {
            const parsedMessage = JSON.parse(message) as any; // any 타입으로 파싱
  
            // Mongoose 모델 객체 메타데이터 제거 (필요한 경우)
            const { __v, _id, $isNew, ...chatData } = parsedMessage;
  
            // 필수 필드가 모두 존재하는지 확인
            if (!chatData.chatRoomId || !chatData.message || !chatData.sender || !chatData.timestamp) {
              console.error(`Invalid chat data: ${JSON.stringify(chatData)}`);
              return null;
            }
  
            // timestamp 변환 시도
            const timestamp = new Date(chatData.timestamp);
            if (isNaN(timestamp.getTime())) {
              console.error(`Invalid timestamp: ${chatData.timestamp}`);
              return null;
            }
  
            return {
              ...chatData, // chatData만 사용
              messageId: score, // score는 이미 number 타입임
              timestamp: timestamp, // 올바른 Date 객체
            };
          } catch (error) {
            console.error(`Error parsing message: ${message}, score: ${score}`, error);
            return null; // 또는 다른 처리 방식
          }
        }).filter((chat): chat is ChatWithMetadata => chat !== null); // null 값 제거
  
        if (chatEntities.length > 0) {
          try {
            await this.commonRepository.saveChatHistoryToMongo(
              new Types.ObjectId(chatRoomId),
              chatEntities
            );
  
            // Redis 캐시 무효화
            await this.redisClient.del(`chatHistorySorted:${chatRoomId}`);
  
          } catch (error) {
            console.error("Error saving chat history:", error);
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
