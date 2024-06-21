import { Module } from '@nestjs/common'
import { MeetingGateway } from './meeting.gateway'
import { OpenViduService } from './meeting.service'
import { MeetingRepository } from './meeting.repository'
// import { JwtAuthWsGuard } from '../guards/jwt-auth.ws.guard'
// import { JwtService } from '@nestjs/jwt'

@Module({
  providers: [
    MeetingGateway,
    OpenViduService,
    MeetingRepository,
    // JwtService,
    // JwtAuthWsGuard,
  ],
})
export class MeetingModule { }
