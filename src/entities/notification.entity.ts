import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose'

@Schema({ timestamps: true })
export class Notification {
  @Prop({ type: String, required: true, ref: 'User' })
  from: string
}
export const NotificationSchema = SchemaFactory.createForClass(Notification)
