import { Injectable } from '@nestjs/common'
import { InjectModel } from '@nestjs/mongoose'
import { User, Friend } from '../entities/user.entity'
import { Model, Types, ObjectId } from 'mongoose'
import { AddFriendDto } from './dto/request/notification.dto'
import { ChatRoom } from '../entities/chat-room.entity'
import { Notification } from '../entities/notification.entity'

@Injectable()
export class CommonRepository {
  constructor(
    @InjectModel(User.name) private readonly userModel: Model<User>,
    @InjectModel(ChatRoom.name) private readonly chatRoomModel: Model<ChatRoom>,
    @InjectModel(Notification.name)
    private readonly notificationModel: Model<Notification>,
  ) {}

  async getNotification(userId: Types.ObjectId): Promise<Notification[]> {
    await this.userModel.findByIdAndUpdate(userId, {
      $set: { newNotification: false },
    })

    const user = await this.userModel
      .findById(userId)
      .populate<{ notifications: Notification[] }>('notifications')
      .lean()

    return user.notifications
  }

  async markNotification(data: AddFriendDto): Promise<Notification> {
    const { userId, friendId } = data
    const notification = new this.notificationModel({
      from: userId,
    })

    await this.userModel.findByIdAndUpdate(friendId, {
      $push: { notifications: notification._id },
    })

    await notification.save()
    return notification
  }

  async getFriends(userId: Types.ObjectId): Promise<ObjectId[]> {
    return await this.userModel
      .findById(userId, { friends: 1 })
      .populate({
        path: 'friends.friend',
        select: '-password -id -_id -newNotification -notifications -friends ',
      })
      .lean()
  }
  async acceptFriend(data: AddFriendDto): Promise<User> {
    const { userId, friendId } = data
    const friend = await this.userModel.findById(friendId)
    if (!friend) throw new Error('없는 유저랍니다.')

    try {
      await this.userModel.findByIdAndUpdate(
        userId,
        { $pull: { notifications: { sender: friendId } } },
        { new: true },
      )

      const newChatRoom = new this.chatRoomModel({ chats: [] })
      await newChatRoom.save()

      const newFriend: Friend = {
        friend: friend._id,
        chatRoomId: newChatRoom._id,
        newMessage: false,
      }

      const newFriendForFriend: Friend = {
        friend: userId,
        chatRoomId: newChatRoom._id,
        newMessage: false,
      }

      await this.userModel.findByIdAndUpdate(
        friendId,
        { $push: { friends: newFriendForFriend } },
        { new: true },
      )

      const updatedUser = await this.userModel
        .findByIdAndUpdate(
          userId,
          { $push: { friends: newFriend } },
          { new: true },
        )
        .lean()

      return updatedUser
    } catch (error) {
      throw new Error('친구 추가 실패했어용.')
    }
  }
}
