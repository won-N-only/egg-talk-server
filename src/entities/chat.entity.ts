import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose'
import { Types } from 'mongoose'

@Schema({ timestamps: true })
export class Chat {
  @Prop({ type: String, required: true })
  sender: string

  @Prop({ type: String, required: true })
  message: string

  @Prop({ type: Types.ObjectId, ref: 'ChatRoom', required: true })
  chatRoomId: Types.ObjectId;
}

export const ChatSchema = SchemaFactory.createForClass(Chat)
