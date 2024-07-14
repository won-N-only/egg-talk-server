import { Module } from '@nestjs/common'
import { MeetingGateway } from './meeting.gateway'
import { MeetingService } from './services/meeting.service'
import { MeetingRepository } from './meeting.repository'
import { JwtAuthWsGuard } from '../guards/jwt-auth.ws.guard'
import { JwtService } from '@nestjs/jwt'
import { QueueService } from './services/queue.service'
import { ConfigService } from '@nestjs/config'
import { UsersModule } from '../users/users.module'
import { CommonService } from '../common/common.service'
import { CommonModule } from 'src/common/common.module'

@Module({
  imports: [UsersModule, CommonModule],
  providers: [
    MeetingGateway,
    CommonService,
    MeetingService,
    QueueService,
    MeetingRepository,
    JwtService,
    JwtAuthWsGuard,
    ConfigService,
  ],
})
export class MeetingModule {}
