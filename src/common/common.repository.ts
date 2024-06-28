import { Injectable } from '@nestjs/common'
import { InjectModel } from '@nestjs/mongoose'
import { Model, Types } from 'mongoose'
import { ChatRoom } from 'src/entities/chat-room.entity'
import { Chat } from 'src/entities/chat.entity'
import { User } from 'src/entities/user.entity'

@Injectable()
export class CommonRepository {
  constructor(
    @InjectModel(ChatRoom.name) private chatRoomModel: Model<ChatRoom>,
    @InjectModel(Chat.name) private chatModel: Model<Chat>,
    @InjectModel(User.name) private userModel: Model<User>,
  ) {}

  async getChatRoomMessage(chatRoomObjectId: Types.ObjectId) {
    return await this.chatRoomModel
      .findByIdAndUpdate(
        chatRoomObjectId,
        { $set: { isRead: true } },
        { new: true },
      )
      .populate({
        path: 'chats',
        model: 'Chat',
        options: { sort: { createAt: 1 } },
        populate: { path: 'sender', select: 'nickname' },
      })
      .lean()
      .exec()
  }

  async saveMessagetoChatRoom(
    sender: string,
    message: string,
    chatRoomId: string,
    isReceiverOnline: boolean,
  ): Promise<Chat> {
    const newChat = await this.chatModel.create({ sender, message })
    await this.chatRoomModel.findByIdAndUpdate(chatRoomId, {
      $push: { chats: newChat._id },
      isRead: isReceiverOnline,
    })
    return newChat
  }

}
