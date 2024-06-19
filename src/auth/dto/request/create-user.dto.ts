import { IsEnum, IsString } from 'class-validator'
import { GenderTypes } from '../../../entities/user.entity'

export class CreateUserDto {
  @IsString()
  id: string

  @IsString()
  nickname: string

  @IsString()
  password: string

  @IsString()
  @IsEnum(Object.values(GenderTypes))
  gender: string
}
