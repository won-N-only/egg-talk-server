import { IsString, IsNotEmpty } from 'class-validator'

export class ReqAddFriendDto {
  @IsString()
  @IsNotEmpty()
  friendId: string //objid아니고 그냥 id로
}
