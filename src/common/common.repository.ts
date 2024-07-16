import { Inject, Injectable } from '@nestjs/common'
import { InjectModel } from '@nestjs/mongoose'
import { User, Friend } from '../entities/user.entity'
import { Model, Types, ObjectId } from 'mongoose'
import { AcceptFriend, AddFriendDto } from './dto/request/notification.dto'
import { ChatRoom } from '../entities/chat-room.entity'
import { Notification } from '../entities/notification.entity'
import { Chat, ChatWithMetadata } from '../entities/chat.entity'
import { CACHE_MANAGER } from '@nestjs/cache-manager'
import { Redis } from 'ioredis'
import { Cache } from 'cache-manager'
@Injectable()
export class CommonRepository {
  private redisClient: Redis

  constructor(
    @InjectModel(User.name) private readonly userModel: Model<User>,
    @InjectModel(ChatRoom.name) private readonly chatRoomModel: Model<ChatRoom>,
    @InjectModel(Chat.name) private chatModel: Model<Chat>,
    @InjectModel(Notification.name)
    private readonly notificationModel: Model<Notification>,
    @Inject(CACHE_MANAGER) private cacheManager: Cache,
  ) {
    this.redisClient = (this.cacheManager as any).store.getClient()
  }

  async getNotification(nickname: String): Promise<Notification[]> {
    await this.userModel.findOneAndUpdate(
      { nickname },
      {
        $set: { newNotification: false },
      },
    )

    const user = await this.userModel
      .findOne({ nickname })
      .populate<{ notifications: Notification[] }>('notifications')
      .lean()

    return user.notifications
  }

  async markNotification(data: AddFriendDto): Promise<Notification> {
    const { userNickname, friendNickname } = data
    const notification = new this.notificationModel({
      from: userNickname,
    })

    await this.userModel.findOneAndUpdate(
      { nickname: friendNickname },
      {
        $push: { notifications: notification._id },
      },
    )

    await notification.save()
    return notification
  }

  async getFriends(nickname: string): Promise<ObjectId[]> {
    return await this.userModel
      .findOne({ nickname }, { friends: 1, _id: 0 })
      .lean()
  }

  async acceptFriend(data: AcceptFriend): Promise<User> {
    const { userNickname, friendNickname, notificationId } = data
    const friend = await this.userModel.findOne({ nickname: friendNickname })
    if (!friend) throw new Error('없는 유저랍니다.')
    const notificationObjectId = new Types.ObjectId(notificationId)

    try {
      await this.userModel
        .findOneAndUpdate(
          { nickname: userNickname },
          { $pull: { notifications: notificationObjectId } },
          { new: true },
        )
        .exec()

      await this.notificationModel.deleteOne({ _id: notificationId })

      const newChatRoom = new this.chatRoomModel({ chats: [] })
      await newChatRoom.save()

      const newFriend: Friend = {
        friend: friendNickname,
        chatRoomId: newChatRoom._id,
        newMessage: false,
      }

      const newFriendForFriend: Friend = {
        friend: userNickname,
        chatRoomId: newChatRoom._id,
        newMessage: false,
      }

      await this.userModel.findOneAndUpdate(
        { nickname: friendNickname },
        { $push: { friends: newFriendForFriend } },
        { new: true },
      )

      const updatedUser = await this.userModel
        .findOneAndUpdate(
          { nickname: userNickname },
          { $push: { friends: newFriend } },
          { new: true },
        )
        .lean()

      return updatedUser
    } catch (error) {
      throw new Error('친구 추가 실패했어용.')
    }
  }

  async updateChatRoomIsRead(
    chatRoomId: string,
    isRead: boolean,
  ): Promise<void> {
    await this.chatRoomModel.findByIdAndUpdate(chatRoomId, { isRead })
  }

  async setNewNotification(userId: string) {
    await this.userModel.findOneAndUpdate(
      { nickname: userId },
      { $set: { newNotification: true } },
    )
  }

  async getFriendIds(userId: string) {
    return await this.userModel.findOne({ nickname: userId }).lean().exec()
  }

  async changeNewMessage(receiverNickname: string, userNickname: string) {
    try {
      const user = await this.userModel.findOne({ nickname: receiverNickname })

      const friendToUpdateIndex = user.friends.findIndex(
        friend => friend.friend == userNickname,
      )

      user.friends[friendToUpdateIndex].newMessage = true
      await user.save()
    } catch (error) {
      throw error
    }
  }
  async changeReadMessage(receiverNickname: string, userNickname: string) {
    try {
      const user = await this.userModel.findOne({ nickname: userNickname })

      const friendToUpdateIndex = user.friends.findIndex(
        friend => friend.friend == receiverNickname,
      )

      user.friends[friendToUpdateIndex].newMessage = false
      await user.save()
    } catch (error) {
      throw error
    }
  }

  async saveChatHistoryToMongo(
    chatRoomId: Types.ObjectId,
    chats: ChatWithMetadata[],
  ): Promise<void> {
    try {
      const chatRoom = await this.chatRoomModel.findById(chatRoomId)

      if (!chatRoom) {
        throw new Error(`ChatRoom not found with ID: ${chatRoomId}`)
      }

      // 1. 이미 저장된 메시지 필터링 (필요에 따라 추가)
      const unsavedChats = chats.filter(chat => !chat._id)

      // 2. Chat 모델 인스턴스 생성 및 저장 (messageId, timestamp 제거)
      const chatInstances = unsavedChats.map(chatData => {
        const { messageId, ...chatWithoutMessageId } = chatData // messageId 제거
        return new this.chatModel(chatWithoutMessageId)
      })
      const savedChats = await this.chatModel.insertMany(chatInstances)

      // 3. 저장된 채팅 메시지의 ObjectId 가져오기
      const savedChatIds = savedChats.map(chat => chat._id)

      // 4. ChatRoom에 채팅 메시지 ID 추가 및 저장
      chatRoom.chats.push(...savedChatIds)
      await chatRoom.save()
    } catch (error) {
      console.error('Error saving chat history to MongoDB:', error)
      throw error // 에러를 상위 계층으로 전파
    }
  }

  // 기존의 데이터베이스 조회 로직을 그대로 사용
  async getChatHistoryFromDatabase(chatRoomId: string) {
    const chatRoomIdObj = new Types.ObjectId(chatRoomId) // ObjectId로 변환
    const chatRoom = await this.chatRoomModel
      .findByIdAndUpdate(
        chatRoomIdObj,
        { $set: { isRead: true } },
        { new: true },
      )
      .lean()
      .exec()

    if (chatRoom) {
      const populatedChatRoom = await this.chatRoomModel.populate(chatRoom, {
        path: 'chats', // 'chats' 필드를 populate
        model: 'Chat', // Chat 모델을 사용하여 populate
        options: { sort: { createdAt: 1 } }, // 오름차순 정렬
        populate: {
          path: 'sender', // Chat 모델의 'sender' 필드를 populate
          select: 'nickname', // sender의 nickname만 가져옴
        },
      })
      return populatedChatRoom
    } else {
      console.error(`Chat room not found for chatRoomId: ${chatRoomId}`)
      return null
    }
  }
  // 최근 메세지 가져오는 함수
  async getLastSavedMessage(chatRoomId: string) {
    try {
      const messageCount = await this.chatModel.countDocuments({ chatRoomId })
      if (messageCount === 0) {
        console.log(`No messages found for chatRoomId ${chatRoomId}`)
        return null
      }

      const lastMessage = await this.chatModel
        .findOne({ chatRoomId })
        .sort({ timestamp: -1 })
        .exec()

      return lastMessage
    } catch (error) {
      console.error(
        `Error fetching last saved message for chatRoomId ${chatRoomId}: ${error.message}`,
      )
      return null
    }
  }
}
