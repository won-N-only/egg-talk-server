import { Injectable, NotFoundException } from '@nestjs/common'
import { UsersRepository } from './users.repository'
import { ReqGetUserDto } from './dto/request/get-user.dto'
import { ResGetUserDto } from './dto/response/get-user.dto'
import { plainToClass } from 'class-transformer'

@Injectable()
export class UsersService {
  constructor(private readonly usersRepository: UsersRepository) {}

  async findOne(ReqGetUserDto: ReqGetUserDto): Promise<ResGetUserDto> {
    const user = await this.usersRepository.findOne(ReqGetUserDto)
    if (!user) throw new NotFoundException('유저가 없습니다.')

    const resGetUserDto = plainToClass(ResGetUserDto, user)
    return resGetUserDto
  }

  async patchAvatar(filter: object, avatar: object): Promise<Object> {
    const updatedUser = await this.usersRepository.updateAvatar(filter, avatar)
    return updatedUser.avatar
  }
}
