import { Injectable, Inject } from '@nestjs/common'
import { SessionService } from './session.service'
import Redis from 'ioredis'

@Injectable()
export class RedisService {
  private subscriber: Redis
  private sessionService: SessionService
  constructor(@Inject('REDIS') redis: Redis, sessionService: SessionService) {
    this.subscriber = redis.duplicate()
    this.sessionService = sessionService
    this.initSubscriber()
  }

  private initSubscriber() {
    const keyPattern = '__keyspace@0__:sessionId*'
    this.subscriber.psubscribe(keyPattern)

    this.subscriber.on('pmessage', (channel, message) => {
      const key = channel.split(':')[1]
      if (message === 'set') {
        this.sessionService.startVideoChatSession(key)
      }
    })
  }
}
