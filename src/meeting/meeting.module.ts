import { Module } from '@nestjs/common'
import { MeetingGateway } from './meeting.gateway'
import { OpenViduService } from './services/meeting.service'
import { MeetingRepository } from './meeting.repository'
import { JwtAuthWsGuard } from '../guards/jwt-auth.ws.guard'
import { JwtService } from '@nestjs/jwt'
import { QueueService } from './services/queue.service'
import { ConfigService } from '@nestjs/config'

@Module({
  providers: [
    MeetingGateway,
    OpenViduService,
    QueueService,
    MeetingRepository,
    JwtService,
    JwtAuthWsGuard,
    ConfigService,
  ],
})
export class MeetingModule {}
