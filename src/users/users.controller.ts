import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  UseGuards,
} from '@nestjs/common'
import { UsersService } from './users.service'
import { JwtAuthRestGuard } from '../guards/jwt-auth.rest.guard'
import { ReqGetUserDto } from './dto/request/get-user.dto'

@UseGuards(JwtAuthRestGuard)
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get()
  @HttpCode(HttpStatus.OK)
  async getUser(reqGetUserDto: ReqGetUserDto) {
    return this.usersService.findOne(reqGetUserDto)
  }
}
