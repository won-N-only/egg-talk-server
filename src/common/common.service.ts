import { Injectable } from '@nestjs/common'
import { InjectModel } from '@nestjs/mongoose'
import { Model, Types } from 'mongoose'
import { Chat } from '../entities/chat.entity'
import { ChatRoom } from '../entities/chat-room.entity'
import { User } from '../entities/user.entity'
import { CommonRepository } from './common.repository'
import { ObjectId } from 'mongoose'
import { AddFriendDto } from './dto/request/notification.dto'
import { UsersRepository } from '../users/users.repository'
import { Notification } from '../entities/notification.entity'

@Injectable()
export class CommonService {
  constructor(
    private readonly commonRepository: CommonRepository,
    private readonly usersRepository: UsersRepository,
    @InjectModel(ChatRoom.name) private chatRoomModel: Model<ChatRoom>,
    @InjectModel(Chat.name) private chatModel: Model<Chat>,
    @InjectModel(User.name) private userModel: Model<User>,
  ) {}

  async getChatHistory(chatRoomId: string, userId: string): Promise<Chat[]> {
    // 1. ChatRoom ObjectId로 변환
    const chatRoomIdObj = new Types.ObjectId(chatRoomId)

    // 2. 해당 ChatRoom의 chats 배열 가져오기
    const chatRoom = await this.chatRoomModel
      .findByIdAndUpdate(
        chatRoomIdObj,
        { $set: { isRead: true } }, // isRead를 true로 업데이트
        { new: true },
      )
      .exec() // { new : true } 옵션 지정해줘야 바뀐 데이터 반환가능
    const chatIds = chatRoom?.chats || [] // chatRoom이 없으면 빈 배열

    // 3. Chat 배열 조회 및 populate
    const chats = await this.chatModel
      .find({ _id: { $in: chatIds } }) // chatIds에 속하는 Chat만 조회
      // .populate('sender', 'username') // sender 정보 populate (필요한 경우)
      .sort({ createdAt: 1 }) // createdAt 기준 오름차순 정렬
      .exec()

    console.log(chats)
    return chats
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

  async getNotifications(userId: Types.ObjectId): Promise<Notification[]> {
    return this.commonRepository.getNotification(userId)
  }

  async markNotification(data: AddFriendDto): Promise<Notification> {
    const { userId, friendId } = data
    if (userId == friendId)
      throw new Error(`자기자신은 ${data.type} 등록 안됩니다`)

    const user = await this.usersRepository.findOne({ _id: userId })

    /**파티 시스템 구현 후 이미 파티인 사람도 throw new Error 할 예정  */
    if (user.friends.some(f => f.friend == friendId))
      throw new Error(`이미 ${data.type}에용.`)

    return await this.commonRepository.markNotification(data)
  }
}
