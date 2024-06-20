import {
  Body,
  Post,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  UseGuards,
  Query,
  Patch,
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
    return this.usersService.getAvatar(reqGetUserDto)
  }

  @Patch('/avatar')
  @HttpCode(HttpStatus.OK)
  async patchUserAvatar(
    @Query() reqGetUserDto: ReqGetUserDto,
    /**TODO: 아바타 obj 아니고 indexnumber면 나중에 바꿔야함 */
    @Body() avatar: Object,
  ): Promise<Object> {
    return this.usersService.patchAvatar(reqGetUserDto, avatar)
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
