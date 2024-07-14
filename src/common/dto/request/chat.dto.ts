import { Types } from 'mongoose'

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