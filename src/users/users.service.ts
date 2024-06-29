import { Injectable, NotFoundException } from '@nestjs/common'
import { UsersRepository } from './users.repository'
import { ResGetUserDto } from './dto/response/get-user.dto'
import { plainToClass } from 'class-transformer'

@Injectable()
export class UsersService {
  constructor(private readonly usersRepository: UsersRepository) {}

  async findOne(nickname: string): Promise<ResGetUserDto> {
    const user = await this.usersRepository.findOne(nickname)
    if (!user) throw new NotFoundException('유저가 없습니다.')

    const resGetUserDto = plainToClass(ResGetUserDto, user)
    return resGetUserDto
  }

  async patchAvatar(nickname: string, avatar: object): Promise<Object> {
    const updatedUser = await this.usersRepository.updateAvatar(nickname, avatar)
    return updatedUser.avatar
  }
}
