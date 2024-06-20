import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose'
import { Document, Types } from 'mongoose'

export type ChatDocument = Chat & Document

@Schema({ timestamps: true })
export class Chat {
  @Prop({ type: Types.ObjectId, required: true })
  sender: Types.ObjectId

  @Prop({ type: String, required: true })
  message: string

  @Prop({ type: Date, default: Date.now })
  createdAt: Date

  @Prop({ type: Boolean, default: false })
  isRead: boolean
}

export const ChatSchema = SchemaFactory.createForClass(Chat)
