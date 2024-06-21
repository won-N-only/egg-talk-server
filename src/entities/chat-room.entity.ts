import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose'
import { Types } from 'mongoose'

@Schema({ timestamps: true })
export class ChatRoom {
  @Prop({ type: [Types.ObjectId] })
  chats: Types.ObjectId[]
}

export const ChatRoomSchema = SchemaFactory.createForClass(ChatRoom)
