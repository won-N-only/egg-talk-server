import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose'
import { Types } from 'mongoose'

@Schema({ _id: false })
class Friend {
  @Prop({ type: Types.ObjectId, required: true })
  _id: Types.ObjectId

  @Prop({ type: Types.ObjectId, required: true })
  chatRoomId: Types.ObjectId

  @Prop({ type: Boolean, required: false, default: false })
  newMessage: boolean
}

const FriendSchema = SchemaFactory.createForClass(Friend)

enum GenderTypes {
  MALE = 'MALE',
  FEMALE = 'FEMALE',
}

@Schema({ timestamps: true })
export class User {
  @Prop({ type: String, required: true })
  id: string

  @Prop({ type: String, required: true })
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
}

export const UserSchema = SchemaFactory.createForClass(User)
