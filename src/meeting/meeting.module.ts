import { Module } from '@nestjs/common'
import { MeetingGateway } from './meeting.gateway'
import { MeetingService } from './services/meeting.service'
import { MeetingRepository } from './meeting.repository'
import { JwtAuthWsGuard } from '../guards/jwt-auth.ws.guard'
import { JwtService } from '@nestjs/jwt'
import { QueueService } from './services/queue.service'
import { ConfigService } from '@nestjs/config'
import { SessionService } from './services/session.service'
import { TimerService } from './services/timer.service'
import { DrawingContestService } from './services/drawingContest.service'
import { CommonModule } from '../common/common.module'
import Redis from 'ioredis'
import { UsersModule } from 'src/users/users.module'
import { CommonService } from 'src/common/common.service'

@Module({
  imports: [UsersModule, CommonModule],
  providers: [
    {
      provide: 'REDIS',
      useFactory: () => {
        return new Redis({
          host: process.env.REDIS_HOST,
          port: parseInt(process.env.REDIS_PORT),
        })
      },
    },
    MeetingGateway,
    CommonService,
    MeetingService,
    QueueService,
    MeetingRepository,
    JwtService,
    JwtAuthWsGuard,
    ConfigService,
    SessionService,
    DrawingContestService,
    TimerService,
  ],
  exports: ['REDIS'],
})
export class MeetingModule {}
