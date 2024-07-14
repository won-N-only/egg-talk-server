import { Injectable, Inject } from '@nestjs/common'
import { Socket } from 'socket.io'
import { MeetingService } from './meeting.service'
import Redis from 'ioredis'
import { CommonService } from '../../common/common.service'
import { SessionService } from './session.service'

@Injectable()
export class QueueService {
  private redis: Redis
  private userQueueCount = 3
  constructor(
    private readonly meetingService: MeetingService,
    private readonly sessionService: SessionService,
    private readonly commonService: CommonService,
    @Inject('REDIS') redis: Redis,
  ) {
    this.redis = redis
  }

  /* 참여자 대기열 추가 */
  async addParticipant(name: string, socket: Socket, gender: string) {
    const participant = JSON.stringify({ name, socketId: socket.id })
    const genderQueue = gender === 'MALE' ? 'maleQueue' : 'femaleQueue'

    const queue = await this.redis.lrange(genderQueue, 0, -1)

    /**중복 유저 제거과정 최적화 필요 */
    for (const item of queue) {
      const parsedItem = JSON.parse(item)
      if (parsedItem.name === name) {
        await this.redis.lrem(genderQueue, 0, item)
      }
    }

    await this.redis.rpush(genderQueue, participant)
    console.log(
      `${gender} Queue : `,
      (await this.redis.lrange(genderQueue, 0, -1)).map(
        item => JSON.parse(item).name,
      ),
    )
  }

  async removeParticipant(name: string, gender: string) {
    const genderQueue = gender === 'MALE' ? 'maleQueue' : 'femaleQueue'
    const queue = await this.redis.lrange(genderQueue, 0, -1)
    for (const item of queue) {
      const parsedItem = JSON.parse(item)
      if (parsedItem.name === name) {
        await this.redis.lrem(genderQueue, 0, item)
        break
      }
    }
  }

  async findOrCreateNewSession(): Promise<string> {
    const newSessionId = this.meetingService.generateSessionId()
    await this.sessionService.createSession(newSessionId)
    console.log(`Creating and returning new session: ${newSessionId}`)
    return newSessionId
  }

  /* 남녀 3명씩 끊어서 처리하는 작업 */
  async handleJoinQueue(
    participantName: string,
    client: Socket,
    gender: string,
  ) {
    let sessionId = ''
    try {
      await this.addParticipant(participantName, client, gender)

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

        const readyMales = maleQueue
          .splice(0, this.userQueueCount)
          .map(item => JSON.parse(item))
        const readyFemales = femaleQueue
          .splice(0, this.userQueueCount)
          .map(item => JSON.parse(item))

        const readyUsers = [...readyMales, ...readyFemales]
        for (const user of readyUsers) {
          this.meetingService.addParticipant(
            sessionId,
            user.name,
            user.socketId,
          )
        }

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
