import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose'
import { Types } from 'mongoose'

export enum NotificationTypes {
  FRIEND = 'FRIEND',
  PARTY = 'PARTY',
}

@Schema({ timestamps: true })
export class Notification {
  @Prop({ type: Types.ObjectId, required: true, ref: 'User' })
  from: Types.ObjectId

  @Prop({ type: String, enum: NotificationTypes })
  notificationType: string
}
export const NotificationSchema = SchemaFactory.createForClass(Notification)
