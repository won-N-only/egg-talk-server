import { IsString, IsNotEmpty } from 'class-validator'

export class AddFriendDto {
  @IsString()
  @IsNotEmpty()
  friendId: string //objid아니고 그냥 id로
}
