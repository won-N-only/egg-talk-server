export class ResGetUserDto {
  _id: string

  id: string
  nickname: string

  gender: 'MALE' | 'FEMALE'
  avatar: object

  newNotification: boolean
  notifications: string[] // Notification의 ObjectId 목록
  friends: Array<{
    _id: string // 친구 id
    chatRoomId: string // 채팅방 id
    newMessage: boolean
  }>

  createdAt: Date
}
