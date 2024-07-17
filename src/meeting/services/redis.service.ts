import { Injectable, Inject } from '@nestjs/common'
import { SessionService } from './session.service'
import Redis from 'ioredis'

@Injectable()
export class RedisService {
  // private subscriber: Redis TODO
  constructor() {
    // private readonly sessionService: SessionService, // @Inject('REDIS') private readonly redis: Redis,
    // this.subscriber = redis.duplicate()
    // this.initSubscriber()
  }

  // private initSubscriber() {
  //   this.redis.config('SET', 'notify-keyspace-events', 'K$')
  //   const keyPattern = '__keyspace@0__:sessionId:*:openViduUrl'
  //   this.subscriber.psubscribe(keyPattern)
  //   this.subscriber.on('pmessage', async (pattern, channel, message) => {
  //     const sessionId = channel.split(':')[2]
  //     const openViduUrl =
  //       await this.sessionService.getOpenViduUrlBySessionId(sessionId)
  //     console.log('subscribe success', openViduUrl)
  //     if (openViduUrl) {
  //       this.sessionService.startVideoChatSession(sessionId, openViduUrl)
  //     }
  //   })
  // }
}
