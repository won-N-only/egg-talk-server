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

  async findOne(filter: object): Promise<ResGetUserDto> {
    return await this.userModel.findOne(filter, { password: 0 }).lean()
  }
}
