import { Module } from '@nestjs/common'
import { MeetingGateway } from './meeting.gateway'
import { MeetingService } from './meeting.service'
import { MeetingRepository } from './meeting.repository'
import { JwtAuthWsGuard } from '../guards/jwt-auth.ws.guard'
import { JwtService } from '@nestjs/jwt'

@Module({
  providers: [
    MeetingGateway,
    MeetingService,
    MeetingRepository,
    JwtService,
    JwtAuthWsGuard,
  ],
})
export class MeetingModule {}
