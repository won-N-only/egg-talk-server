import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose'
import { Types } from 'mongoose'

export enum NotificationTypes {
  FRIEND = 'FRIEND',
}

@Schema({ timestamps: true })
export class Notification {
  @Prop({ type: Types.ObjectId, required: true, ref: 'User' })
  from: Types.ObjectId
}
export const NotificationSchema = SchemaFactory.createForClass(Notification)
