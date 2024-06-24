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
@UseGuards(JwtAuthRestGuard)
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get()
  @HttpCode(HttpStatus.OK)
  async getUser(@Req() request: Request): Promise<ResGetUserDto> {
    const userId = request['user']._id
    return this.usersService.findOne(userId)
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
}
