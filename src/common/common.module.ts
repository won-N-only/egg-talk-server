import { Module } from '@nestjs/common'
import { CommonGateway } from './common.gateway'
import { CommonService } from './common.service'
import { CommonRepository } from './common.repository'
import { JwtAuthWsGuard } from '../guards/jwt-auth.ws.guard'
import { JwtService } from '@nestjs/jwt'
import { MongooseModule } from '@nestjs/mongoose'
import { Chat, ChatSchema } from '../entities/chat.entity'
import { ChatRoom, ChatRoomSchema } from '../entities/chat-room.entity'
import { User, UserSchema } from '../entities/user.entity'
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Chat.name, schema: ChatSchema },
      { name: ChatRoom.name, schema: ChatRoomSchema },
      { name: User.name, schema: UserSchema}
    ]),
  ],
  providers: [
    CommonGateway,
    CommonService,
    CommonRepository,
    JwtService,
    JwtAuthWsGuard,
  ],
})
export class CommonModule {}
