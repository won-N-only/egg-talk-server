import { Module } from '@nestjs/common'
import { ChatsController } from './chats.controller'
import { ChatsService } from './chats.service'
import { ChatsRepository } from './chats.repository'
import { JwtAuthRestGuard } from '../guards/jwt-auth.rest.guard'
import { JwtService } from '@nestjs/jwt'

@Module({
  controllers: [ChatsController],
  providers: [ChatsService, ChatsRepository, JwtService, JwtAuthRestGuard],
})
export class ChatsModule {}
