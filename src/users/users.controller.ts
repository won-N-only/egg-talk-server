import { Controller, Get, UseGuards } from '@nestjs/common'
import { JwtAuthRestGuard } from '../guards/jwt-auth.rest.guard'

@UseGuards(JwtAuthRestGuard)
@Controller('users')
export class UsersController {
  @Get()
  getHello(): string {
    return 'this is users!'
  }
}
