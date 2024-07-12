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
export class joinChatDto {
  newChatRoomId: string
  friendName: string
}
export class sendMessageDto {
  userNickname: string
  chatRoomId: string
  message: string
  receiverNickname: string
}

