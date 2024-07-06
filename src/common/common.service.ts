import { Injectable } from '@nestjs/common'
import { AcceptFriend, AddFriendDto } from './dto/request/notification.dto'
import { UsersRepository } from '../users/users.repository'
import { Notification } from '../entities/notification.entity'
import { Types, ObjectId } from 'mongoose'
import { Chat } from '../entities/chat.entity'
import { User } from '../entities/user.entity'
import { Server, Socket } from 'socket.io'
import { CommonRepository } from './common.repository'

@Injectable()
export class CommonService {
  constructor(
    private readonly commonRepository: CommonRepository,
    private readonly usersRepository: UsersRepository,
  ) {}
  private server: Server
  private connectedUsers = new Map<string, Socket>() // userId: Socket
  private connectedSockets = new Map<string, string>() // socketId: userId

  setServer(server: Server) {
    this.server = server
  }

  getSocketByUserId(nickname: string): Socket {
    return this.connectedUsers.get(nickname)
  }

  getUserIdBySocketId(socketId: string): string {
    return this.connectedSockets.get(socketId)
  }

  addUser(nickname: string, socket: Socket): void {
    this.connectedUsers.set(nickname, socket)
    this.connectedSockets.set(socket.id, nickname)
  }

  removeUser(nickname: string, socketId: string): void {
    this.connectedSockets.delete(socketId)
    this.connectedUsers.delete(nickname)
  }

  async getChatHistory(chatRoomId: string): Promise<Chat[]> {
    // 1. ChatRoom ObjectId로 변환
    const chatRoomIdObj = new Types.ObjectId(chatRoomId)

    const chatRoom =
      await this.commonRepository.getChatRoomMessage(chatRoomIdObj)
    console.log('chatroom populate result: ', chatRoom.chats)
    return chatRoom.chats as unknown as Chat[]
  }

  async sendMessage(
    senderNickName: string,
    chatRoomId: string,
    message: string,
    isReceiverOnline: boolean,
  ): Promise<Chat> {
    try {
      //DTO
      const newChat = await this.commonRepository.saveMessagetoChatRoom(
        senderNickName,
        message,
        chatRoomId,
        isReceiverOnline,
      )
      return newChat
    } catch (error) {
      console.error('메시지 저장 실패:', error)
      throw error
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
    return await this.commonRepository.acceptFriend(data)
  }

  async newMessage(receiverNickname: string, userNickname: string) {
    try{
      this.commonRepository.changeNewMessage(receiverNickname, userNickname);
    } catch (error) {
      throw error
    }
  }
}
