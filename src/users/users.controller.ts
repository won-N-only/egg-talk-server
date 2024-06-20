import {
  Body,
  Post,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  UseGuards,
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

  @Get('me')
  @HttpCode(HttpStatus.OK)
  async getUser(reqGetUserDto: ReqGetUserDto): Promise<ResGetUserDto> {
    return this.usersService.findOne(reqGetUserDto)
  }

  //요청받은 유저가 ok 했을 때
  @Post('/friends')
  @HttpCode(HttpStatus.OK)
  async addFriend(
    @Body() addFriendDto: ReqAddFriendDto,
  ): Promise<ResGetUserDto> {
    const { userId, friendId } = addFriendDto
    return this.usersService.addFriend(userId, friendId)
  }
}
