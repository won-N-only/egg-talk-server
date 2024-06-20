import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose'
import { Types } from 'mongoose'
import { Notification } from './notification.entity'

@Schema({ _id: false })
class Friend {
  @Prop({ type: String, required: true, ref: 'User' })
  friend: string

  @Prop({ type: Types.ObjectId, required: true })
  chatRoomId: Types.ObjectId

  @Prop({ type: Boolean, required: false, default: false })
  newMessage: boolean
}

const FriendSchema = SchemaFactory.createForClass(Friend)

export enum GenderTypes {
  MALE = 'MALE',
  FEMALE = 'FEMALE',
}

@Schema({ timestamps: true })
export class User {
  @Prop({ type: String, required: true, unique: true })
  id: string

  @Prop({ type: String, required: true, unique: true })
  nickname: string

  @Prop({ type: String, required: true })
  password: string

  @Prop({ type: [FriendSchema] })
  friends: Friend[]

  @Prop({ type: String, required: true, enum: GenderTypes })
  gender: string

  @Prop({ type: Object, required: false, default: null })
  avatar: object // 정의 필요

  @Prop({ type: Boolean, required: false, default: false })
  newNotification: boolean

  @Prop({
    type: [Types.ObjectId],
    required: false,
    default: [],
    // ref: Notification.name,
  })
  notifications: Types.ObjectId[]
}

export const UserSchema = SchemaFactory.createForClass(User)
