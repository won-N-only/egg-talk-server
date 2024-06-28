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

}
