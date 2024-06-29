import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose'

@Schema({ timestamps: true })
export class Chat {
  @Prop({ type: String, required: true })
  sender: string

  @Prop({ type: String, required: true })
  message: string
}

export const ChatSchema = SchemaFactory.createForClass(Chat)
