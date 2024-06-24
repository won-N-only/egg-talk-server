import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  UseGuards,
  Query,
  Req,
  Patch,
} from '@nestjs/common'
import { UsersService } from './users.service'
import { JwtAuthRestGuard } from '../guards/jwt-auth.rest.guard'
import { ResGetUserDto } from './dto/response/get-user.dto'
import { Types } from 'mongoose'
@UseGuards(JwtAuthRestGuard)
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get()
  @HttpCode(HttpStatus.OK)
  async getUser(@Req() request: Request): Promise<ResGetUserDto> {
    const userId = new Types.ObjectId(request['user']._id)
    return this.usersService.findOne(userId)
  }

  @Patch()
  @HttpCode(HttpStatus.OK)
  async patchUserAvatar(
    @Req() request: Request,
    @Body() avatar: Object, // avatar말고 다른 것도 바꿀 수 있게 수정 예정
  ): Promise<Object> {
    const userId = new Types.ObjectId(request['user']._id)
    return this.usersService.patchAvatar(userId, avatar)
  }
}
