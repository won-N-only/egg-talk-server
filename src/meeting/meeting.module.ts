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
import { RedisService } from './services/redis.service'
import Redis from 'ioredis'

@Module({
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
    MeetingService,
    QueueService,
    MeetingRepository,
    JwtService,
    JwtAuthWsGuard,
    ConfigService,
    SessionService,
    DrawingContestService,
    RedisService,
    TimerService,
  ],
  exports: ['REDIS'],
})
export class MeetingModule {}
