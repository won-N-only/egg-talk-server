import { Injectable } from '@nestjs/common'
import { InjectModel } from '@nestjs/mongoose'
import { Model, Types, ObjectId } from 'mongoose'
import { Chat } from '../entities/chat.entity'
import { ChatRoom } from '../entities/chat-room.entity'
import { User } from '../entities/user.entity'

@Injectable()
export class CommonService {
  constructor(
    @InjectModel(ChatRoom.name) private chatRoomModel: Model<ChatRoom>,
    @InjectModel(Chat.name) private chatModel: Model<Chat>,
    @InjectModel(User.name) private userModel: Model<User>,
  ) {}
  private server: Server
  private connectedUsers = new Map<string, Socket>() // userId: Socket
  private connectedSockets = new Map<string, string>() // socketId: userId

  setServer(server: Server) {
    this.server = server
  }

  getSocketByUserId(userId: string): Socket {
    return this.connectedUsers.get(userId)
  }

  getUserIdBySocketId(socketId: string): string {
    return this.connectedSockets.get(socketId)
  }

  addUser(userId: string, socket: Socket): void {
    this.connectedUsers.set(userId, socket)
    this.connectedSockets.set(socket.id, userId)
  }

  removeUser(userId: string, socketId: string): void {
    this.connectedSockets.delete(userId)
    this.connectedUsers.delete(socketId)
  }

  async getChatHistory(chatRoomId: string, userId: string): Promise<Chat[]> {
    // 1. ChatRoom ObjectId로 변환
    const chatRoomIdObj = new Types.ObjectId(chatRoomId)

    const chatRoom =
      await this.commonRepository.getChatRoomMessage(chatRoomIdObj)
    console.log('chatroom populate result: ', chatRoom.chats)
    return chatRoom.chats as unknown as Chat[]
  }

  async sendMessage(
    senderId: string,
    chatRoomId: string,
    message: string,
    isReceiverOnline: boolean,
  ): Promise<Chat> {
    try {
      // 1. 메시지 저장
      const newChat = await this.chatModel.create({
        sender: senderId,
        message,
      })

      // 2. ChatRoom 업데이트
      await this.chatRoomModel.findByIdAndUpdate(chatRoomId, {
        $push: { chats: newChat._id },
        isRead: isReceiverOnline,
      })
      console.log(newChat)
      return newChat
    } catch (error) {
      console.error('메시지 저장 실패:', error)
      throw error
    }
  }

  async changeNotice(userId: string) {
    try {
      await this.userModel.findOneAndUpdate(
        { id: userId },
        { $set: { newNotification: true } },
      )
    } catch (error) {
      console.error('알림이 전송되지 않았습니다.', error)
      throw error
    }
  }

  async sortfriend(userId: string){
    // 유저 정보를 조회하여 친구목록 화인
    // 내 친구에게만 알림 보내면됨
    try {
      // await this.userModel.findById(userId, { friends : 1 }).lean();
      const friendIds = await this.userModel.findOne({id : userId})
      .select('friends.friend')
      .lean()
      .exec()
      return friendIds.friends.map(elem => elem.friend);
      // return friendIds
    } catch(error){
      throw error
    }
  }

}
