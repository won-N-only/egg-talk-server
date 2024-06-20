export class ResGetUserDto {
  _id: string

  id: string
  nickname: string

  gender: 'MALE' | 'FEMALE'
  avatar: object

  newNotification: boolean
  notifications: string[] // Notification의 ObjectId 목록
  friends: string[]

  createdAt: Date
}
