import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose'
import {  Types } from 'mongoose'

@Schema({ timestamps: true })
export class ChatRoom {

  @Prop({ type: [{ type: Types.ObjectId }] })
  chats: Types.ObjectId[]

  @Prop({ type: Date, default: Date.now })
  createdAt: Date
}

export const ChatRoomSchema = SchemaFactory.createForClass(ChatRoom)
