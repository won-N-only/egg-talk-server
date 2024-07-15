import { Injectable, Inject } from '@nestjs/common'
import { SessionService } from './session.service'
import Redis from 'ioredis'

@Injectable()
export class RedisService {
  private subscriber: Redis
  private redis: Redis
  private sessionService: SessionService
  constructor(@Inject('REDIS') redis: Redis, sessionService: SessionService) {
    this.subscriber = redis.duplicate()
    this.sessionService = sessionService
    this.redis = redis
    this.initSubscriber()
  }

  private initSubscriber() {
    this.redis.config('SET', 'notify-keyspace-events', 'K$')
    const keyPattern = '__keyspace@0__:sessionId*'
    this.subscriber.psubscribe(keyPattern)

    this.subscriber.on('pmessage', async (channel, message) => {
      console.log(channel)
      const key = message.split(':')[2]
      console.log('레디스 성공', message, key)
      if (key) {
        console.log('set 받아서 비디오 시작')
        const url = await this.redis.get(`sessionId:${key}:url`)
        console.log(url)
        // this.sessionService.startVideoChatSession(key)
      }
    })
  }
}
