import { IsString } from 'class-validator'

export class ReqGetUserDto {
  @IsString()
  id: string
}
