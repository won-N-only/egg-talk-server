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
import { CacheModule } from '@nestjs/cache-manager'
import * as redisStore from 'cache-manager-ioredis'

@Module({
  imports: [
    CommonModule,
    CacheModule.register({
      store: redisStore,
      host: process.env.REDIS_HOST,
      port: process.env.REDIS_PORT,
    }),
  ],
  providers: [
    MeetingGateway,
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
  exports: [CacheModule],
})
export class MeetingModule {}
