import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose'
import { Types } from 'mongoose'

@Schema({ timestamps: true })
export class Chat {
  @Prop({ type: Types.ObjectId, required: true })
  sender: Types.ObjectId

  @Prop({ type: String, required: true })
  message: string

  @Prop({ type: Boolean, default: false })
  isRead: boolean
}

export const ChatSchema = SchemaFactory.createForClass(Chat)
