import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common'
import { UsersRepository } from './users.repository'
import { ResGetUserDto } from './dto/response/get-user.dto'
import { plainToClass } from 'class-transformer'

@Injectable()
export class UsersService {
  constructor(private readonly usersRepository: UsersRepository) {}

  async findOne(filter: object): Promise<ResGetUserDto> {
    const user = await this.usersRepository.findOne(filter)
    if (!user) throw new NotFoundException('유저가 없습니다.')

    const resGetUserDto = plainToClass(ResGetUserDto, user)
    return resGetUserDto
  }

  async getAvatar(filter: object): Promise<Object> {
    const user = await this.usersRepository.findOne(filter)
    if (!user) throw new NotFoundException('유저가 없습니다.')

    return user.avatar
  }

  async patchAvatar(filter: object, avatar: object): Promise<Object> {
    const updatedUser = await this.usersRepository.updateAvatar(filter, avatar)
    return updatedUser.avatar
  }

  async addFriend(userId: string, friendId: string): Promise<ResGetUserDto> {
    // 유효한 userId와 friendId를 가지고 있는지 확인
    const user = await this.usersRepository.findOne({ id: userId })
    const friend = await this.usersRepository.findOne({ id: friendId })

    if (!friend) throw new NotFoundException('없는 유저입니다.')

    if (user.friends.some(f => f.friend === friendId))
      throw new BadRequestException('이미 친구에용.')

    const updatedUser = await this.usersRepository.addFriend(userId, friendId)
    return plainToClass(ResGetUserDto, updatedUser)
  }
}
