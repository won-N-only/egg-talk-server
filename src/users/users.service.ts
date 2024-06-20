import { Injectable, NotFoundException } from '@nestjs/common'
import { UsersRepository } from './users.repository'
import { ResGetUserDto } from './dto/response/get-user.dto'
import { plainToClass } from 'class-transformer'

@Injectable()
export class UsersService {
  constructor(private readonly usersRepository: UsersRepository) {}

  async findOne(filter: object): Promise<ResGetUserDto> {
    const user = await this.usersRepository.findOne(filter)
    if (!user) {
      throw new NotFoundException('유저가 없습니다.')
    }
    const resGetUserDto = plainToClass(ResGetUserDto, user) 
    console.log('로그립니디', resGetUserDto._id)

    return resGetUserDto
  }
}
