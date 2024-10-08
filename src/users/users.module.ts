import { Module } from '@nestjs/common'
import { AuthModule } from '../auth/auth.module'
import { UsersController } from './users.controller'
import { UsersService } from './users.service'
import { UsersRepository } from './users.repository'
import { JwtAuthRestGuard } from '../guards/jwt-auth.rest.guard'
import { JwtService } from '@nestjs/jwt'

@Module({
  imports: [AuthModule],
  controllers: [UsersController],
  providers: [UsersService, UsersRepository, JwtService, JwtAuthRestGuard],
})
export class UsersModule {}
