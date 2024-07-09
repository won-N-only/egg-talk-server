import { Module } from '@nestjs/common'
import { MeetingGateway } from './meeting.gateway'
import { MeetingService } from './services/meeting.service'
import { MeetingRepository } from './meeting.repository'
import { JwtAuthWsGuard } from '../guards/jwt-auth.ws.guard'
import { JwtService } from '@nestjs/jwt'
import { QueueService } from './services/queue.service'
import { ConfigService } from '@nestjs/config'
import { CommonModule } from '../common/common.module'

@Module({
  imports: [CommonModule],
  providers: [
    MeetingGateway,
    MeetingService,
    QueueService,
    MeetingRepository,
    JwtService,
    JwtAuthWsGuard,
    ConfigService,
  ],
})
export class MeetingModule {}
