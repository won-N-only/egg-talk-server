import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose'
import { Types } from 'mongoose'

@Schema({ timestamps: true })
export class ChatRoom {
  @Prop({ type: [{ type: Types.ObjectId, ref: 'Chat' }] })
  chats: Types.ObjectId[]

  @Prop({ type: Boolean, default: false })
  isRead: boolean
}

export const ChatRoomSchema = SchemaFactory.createForClass(ChatRoom)
