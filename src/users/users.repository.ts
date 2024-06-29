import { Injectable } from '@nestjs/common'
import { Model } from 'mongoose'
import { User } from '../entities/user.entity'
import { InjectModel } from '@nestjs/mongoose'
import { ResGetUserDto } from './dto/response/get-user.dto'

@Injectable()
export class UsersRepository {
  constructor(
    @InjectModel(User.name) private readonly userModel: Model<User>,
  ) {}

  async findOne(nickname: string): Promise<ResGetUserDto> {
    return await this.userModel.findOne({ nickname }, { password: 0 }).lean()
  }

  async updateAvatar(nickname: string, avatar: object): Promise<User> {
    return await this.userModel
      .findOneAndUpdate({ nickname }, { avatar }, { new: true })
      .lean()
  }
}
