import { Injectable } from '@nestjs/common'
import { InjectModel } from '@nestjs/mongoose'
import { User } from '../entities/user.entity'
import { Model } from 'mongoose'
import { CreateUserDto } from './dto/request/create-user.dto'

@Injectable()
export class AuthRepository {
  constructor(
    @InjectModel(User.name) private readonly userModel: Model<User>,
  ) {}

  create(dto: CreateUserDto) {
    const newUser = new this.userModel(dto)
    return newUser.save()
  }

  findOne(filter: object) {
    return this.userModel.findOne(filter)
  }
}
