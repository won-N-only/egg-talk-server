import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose'
import { Document, Types } from 'mongoose'
export type ChatRoomDocument = ChatRoom & Document

@Schema({ timestamps: true })
export class ChatRoom {

  @Prop({ type: [{ type: Types.ObjectId }] })
  chats: Types.ObjectId[]

  @Prop({ type: Date, default: Date.now })
  createdAt: Date

  @Prop({ type: Boolean, default: false })
  isRead: boolean
}

export const ChatRoomSchema = SchemaFactory.createForClass(ChatRoom)
