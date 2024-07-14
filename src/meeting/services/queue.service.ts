import { Injectable, Inject } from '@nestjs/common'
import { MeetingService } from './meeting.service'
import Redis from 'ioredis'
import { CommonService } from '../../common/common.service'
import { SessionService } from './session.service'

@Injectable()
export class QueueService {
  private redis: Redis
  public userQueueCount = 3
  constructor(
    private readonly meetingService: MeetingService,
    private readonly sessionService: SessionService,
    private readonly commonService: CommonService,
    @Inject('REDIS') redis: Redis,
  ) {
    this.redis = redis
  }

  /* 참여자 대기열 추가 */
  async addParticipantToQueue(name: string, gender: string) {
    const genderQueue = gender === 'MALE' ? 'maleQueue' : 'femaleQueue'

    await this.redis.lrem(genderQueue, 0, name)
    await this.redis.rpush(genderQueue, name)

    console.log(
      `${gender} Queue : `,
      await this.redis.lrange(genderQueue, 0, -1),
    )
  }

  async removeParticipantInQueue(name: string, gender: string) {
    const genderQueue = gender === 'MALE' ? 'maleQueue' : 'femaleQueue'

    await this.redis.lrem(genderQueue, 0, name)
  }

  async findOrCreateNewSession(): Promise<string> {
    const newSessionId = this.sessionService.generateSessionId()
    await this.sessionService.createSession(newSessionId)
    console.log(`Creating and returning new session: ${newSessionId}`)
    return newSessionId
  }

  /* 남녀 3명씩 끊어서 처리하는 작업 */
  async handleJoinQueue(
    participantName: string,
    gender: string,
  ): Promise<{ sessionId: string; readyUsers?: any[] }> {
    let sessionId = ''
    try {
      await this.addParticipantToQueue(participantName, gender)

      const maleQueue = await this.redis.lrange(
        'maleQueue',
        0,
        this.userQueueCount - 1,
      )
      const femaleQueue = await this.redis.lrange(
        'femaleQueue',
        0,
        this.userQueueCount - 1,
      )

      if (
        maleQueue.length >= this.userQueueCount &&
        femaleQueue.length >= this.userQueueCount
      ) {
        sessionId = await this.findOrCreateNewSession()

        const readyMales = maleQueue.splice(0, this.userQueueCount)
        const readyFemales = femaleQueue.splice(0, this.userQueueCount)

        const readyUsers = [...readyMales, ...readyFemales]

        const sessionData = JSON.stringify({
          tokens: [],
          participants: readyUsers,
        })

        await this.redis.set(`sessionId:${sessionId}`, sessionData)
        await this.redis.ltrim('maleQueue', this.userQueueCount, -1)
        await this.redis.ltrim('femaleQueue', this.userQueueCount, -1)

        console.log('현재 큐 시작진입합니다 세션 이름은 : ', sessionId)
        await this.meetingService.startVideoChatSession(sessionId)

        return { sessionId, readyUsers }
      }

      return { sessionId }
    } catch (error) {
      console.error('Error joining queue:', error)
      await this.sessionService.deleteSession(sessionId)
    }
  }
}
