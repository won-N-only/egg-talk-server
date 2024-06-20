import {
  Body,
  Post,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  UseGuards,
  Query,
} from '@nestjs/common'
import { UsersService } from './users.service'
import { JwtAuthRestGuard } from '../guards/jwt-auth.rest.guard'
import { ReqGetUserDto } from './dto/request/get-user.dto'
import { ResGetUserDto } from './dto/response/get-user.dto'
import { ReqAddFriendDto } from './dto/request/add-friend.dto'
@UseGuards(JwtAuthRestGuard)
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get()
  @HttpCode(HttpStatus.OK)
  async getUser(@Query() reqGetUserDto: ReqGetUserDto): Promise<ResGetUserDto> {
    return this.usersService.findOne(reqGetUserDto)
  }

  @Get('/avatar')
  @HttpCode(HttpStatus.OK)
  async getUserAvatar(@Query() reqGetUserDto: ReqGetUserDto): Promise<Object> {
    return this.usersService.findAvatar(reqGetUserDto)
  }

  //친구 요청받은 유저가 ok 했을 때
  @Post('/friends')
  @HttpCode(HttpStatus.OK)
  async addFriend(
    @Body() addFriendDto: ReqAddFriendDto,
  ): Promise<ResGetUserDto> {
    const { userId, friendId } = addFriendDto
    return this.usersService.addFriend(userId, friendId)
  }
}
