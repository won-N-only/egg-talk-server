import { Injectable } from '@nestjs/common'
import { Socket } from 'socket.io'
import { MeetingService } from './meeting.service'
import { Redis } from 'ioredis'

@Injectable()
export class QueueService {
  private redis: Redis

  constructor(private readonly meetingService: MeetingService) {
    this.redis = new Redis({
      host: process.env.REDIS_HOST,
      port: parseInt(process.env.REDIS_PORT, 10),
    })
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
    await this.meetingService.createSession(newSessionId)
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

      const maleQueue = await this.redis.lrange('maleQueue', 0, 3)
      const femaleQueue = await this.redis.lrange('femaleQueue', 0, 3)

      if (maleQueue.length >= 3 && femaleQueue.length >= 3) {
        sessionId = await this.findOrCreateNewSession()
        const readyMales = maleQueue.splice(0, 3).map(item => JSON.parse(item))
        const readyFemales = femaleQueue
          .splice(0, 3)
          .map(item => JSON.parse(item))
        const readyUsers = [...readyMales, ...readyFemales]

        for (const user of readyUsers) {
          this.meetingService.addParticipant(
            sessionId,
            user.name,
            user.socketId,
          )
        }
        await this.redis.ltrim('maleQueue', 3, -1)
        await this.redis.ltrim('femaleQueue', 3, -1)

        console.log('현재 큐 시작진입합니다 세션 이름은 : ', sessionId)
        await this.meetingService.startVideoChatSession(sessionId)
        return { sessionId, readyUsers }
      }

      // 이 부분은 클라 확인차 로그로써 삭제해도 무방 다만 테스트 시 확인이 힘들어짐
      const participants = this.meetingService.getParticipants(sessionId)
      console.log(
        'Current waiting participants: ',
        participants.map(p => p.name),
      )
      return { sessionId }
    } catch (error) {
      console.error('Error joining queue:', error)
      await this.meetingService.deleteSession(sessionId)
    }
  }
}
