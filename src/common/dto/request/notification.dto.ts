import { Types } from 'mongoose'

enum FriendRequestType {
  FRIEND = 'FRIEND',
  PARTY = 'PARTY',
}

export class AddFriendDto {
  userId: Types.ObjectId
  friendId: Types.ObjectId
  type: FriendRequestType
}