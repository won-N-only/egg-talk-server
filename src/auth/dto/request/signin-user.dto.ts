import { IsString } from 'class-validator'

export class SignInUserDto {
  @IsString()
  id: string

  @IsString()
  password: string
}
