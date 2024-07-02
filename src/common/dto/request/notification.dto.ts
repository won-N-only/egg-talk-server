import { Types } from 'mongoose'

export class AddFriendDto {
  userNickname: string
  friendNickname: string
}
export class AcceptFriend {
  userNickname: string
  friendNickname: string
  notificationId: Types.ObjectId
}
