import { Controller, Get, UseGuards } from '@nestjs/common'
import { JwtAuthRestGuard } from '../guards/jwt-auth.rest.guard'

@UseGuards(JwtAuthRestGuard)
@Controller('chats')
export class ChatsController {
  @Get()
  getHello(): string {
    return 'this is chat!'
  }
}
