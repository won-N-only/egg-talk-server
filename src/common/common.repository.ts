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
    //모두 objId로 처리하는게 맞나 생각해보기
    const user = await this.userModel
      .findById(userId)
      .populate<{ notifications: Notification[] }>('notifications')
      .lean() // populate 적용

    return user.notifications
  }

  //노티.타입 으로 나눠지는데 렌더링할때 나눠서 하나?
  async markNotification(data: AddFriendDto): Promise<Notification> {
    const { userId, friendId, type } = data
    const notification = new this.notificationModel({
      from: userId,
      notificationType: type,
    })

    await this.userModel.findByIdAndUpdate(friendId, {
      $push: { notifications: notification._id },
    })

    await notification.save()
    return notification
  }

}
