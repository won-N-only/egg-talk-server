import { Injectable } from '@nestjs/common'
import { Model } from 'mongoose'
import { User } from '../entities/user.entity'
import { ChatRoom } from '../entities/chat-room.entity'
import { InjectModel } from '@nestjs/mongoose'
import { ResGetUserDto } from './dto/response/get-user.dto'
import { NotFound, BadRequest } from 'http-errors'

@Injectable()
export class UsersRepository {
  constructor(
    @InjectModel(User.name) private readonly userModel: Model<User>,
    @InjectModel(ChatRoom.name)
    private readonly chatRoomModel: Model<ChatRoom>,
  ) {}

  async findOne(filter: object): Promise<ResGetUserDto> {
    return await this.userModel.findOne(filter, { password: 0 }).lean()
  }

  async updateAvatar(filter: object, avatar: object): Promise<User> {
    return await this.userModel
      .findOneAndUpdate(filter, { avatar }, { new: true })
      .lean()
  }

  async addFriend(userId: string, friendId: string): Promise<User> {
    // ChatRoom 생성
    const chatRoom = new this.chatRoomModel({ chats: [] })
    await chatRoom.save()
    // 나 업데이트
    await this.userModel.findOneAndUpdate(
      { id: userId },
      {
        $push: {
          friends: {
            friend: friendId,
            chatRoomId: chatRoom._id,
            newMessage: false,
          },
        },
      },
      { new: true },
    )

    // 친구 업데이트
    await this.userModel.findOneAndUpdate(
      { id: friendId },
      {
        $push: {
          friends: {
            friend: userId,
            chatRoomId: chatRoom._id,
            newMessage: false,
          },
        },
      },
      { new: true },
    )

    return await this.userModel.findOne({ id: userId }, { password: 0 }).lean()
  }
}
