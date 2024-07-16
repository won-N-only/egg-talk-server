import { Module } from '@nestjs/common'
import { CommonGateway } from './common.gateway'
import { CommonService } from './common.service'
import { CommonRepository } from './common.repository'
import { JwtAuthWsGuard } from '../guards/jwt-auth.ws.guard'
import { JwtService } from '@nestjs/jwt'
import { MongooseModule } from '@nestjs/mongoose'
import { Chat, ChatSchema } from '../entities/chat.entity'
import { ChatRoom, ChatRoomSchema } from '../entities/chat-room.entity'
import { UsersRepository } from '../users/users.repository'
import { UsersService } from '../users/users.service'
import { User, UserSchema } from '../entities/user.entity'
import {
  Notification,
  NotificationSchema,
} from '../entities/notification.entity'
import { CacheModule } from '@nestjs/cache-manager'
import * as redisStore from 'cache-manager-ioredis'

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Chat.name, schema: ChatSchema },
      { name: ChatRoom.name, schema: ChatRoomSchema },
      { name: User.name, schema: UserSchema },
      { name: Notification.name, schema: NotificationSchema },
    ]),
    CacheModule.register({
      store: redisStore,
      host: process.env.REDIS_HOST,
      port: process.env.REDIS_PORT,
    }),
  ],
  providers: [
    CommonGateway,
    CommonService,
    CommonRepository,
    JwtService,
    JwtAuthWsGuard,
    UsersRepository,
    UsersService,
  ],
  exports: [CacheModule, CommonRepository, CommonService],
})
export class CommonModule {}
