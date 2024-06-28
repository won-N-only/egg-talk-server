import { Types } from 'mongoose'

export class AddFriendDto {
  userId: Types.ObjectId
  friendId: Types.ObjectId
}
