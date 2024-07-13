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
  async getChatHistory(chatRoomdId: string): Promise<Chat[]> {
    // Redis List에서 메시지 가져오기
    const chatHistory = await this.redisClient.lrange(`chatHistory:${chatRoomdId}`, 0, -1)
    return chatHistory.map(message => JSON.parse(message) as Chat)
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
      
      // Redis List에 메세지 추가
      await this.redisClient.rpush(`chatHistory:${chatRoomId}`, JSON.stringify(newChat))

      // 5분마다 채팅 기록을 DB에 저장하는 스케줄러 함수 호출
      return newChat
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
