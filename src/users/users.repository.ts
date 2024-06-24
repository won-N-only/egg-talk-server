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

  async findOne(ReqGetUserDto: ReqGetUserDto): Promise<ResGetUserDto> {
    return await this.userModel
      .findById(ReqGetUserDto._id, { password: 0 })
      .lean()
  }

  async updateAvatar(filter: object, avatar: object): Promise<User> {
    return await this.userModel
      .findOneAndUpdate(filter, { avatar }, { new: true })
      .lean()
  }
}
