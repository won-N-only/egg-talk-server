import { Injectable, Inject } from '@nestjs/common'
import { MeetingService } from './meeting.service'
import Redis from 'ioredis'
import { SessionService } from './session.service'
import { SendMessageCommand, SQSClient } from '@aws-sdk/client-sqs'

@Injectable()
export class QueueService {
  private redis: Redis
  public userQueueCount = 3
  constructor(
    private readonly meetingService: MeetingService,
    private readonly sessionService: SessionService,
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
      console.log(
        maleQueue,
        maleQueue.length,
        femaleQueue,
        femaleQueue.length,
        '큐의 길이 ',
      )
      await this.redis.set(`sessionId:${sessionId}:url`, sessionId)
      if (maleQueue.length + femaleQueue.length === this.userQueueCount) {
        sessionId = await this.findOrCreateNewSession()

        const readyUsers = [...maleQueue, ...femaleQueue]
        for (const user of readyUsers) {
          const socketId =
            await this.meetingService.getSocketIdByParticipantName(user)
          this.sessionService.addParticipant(sessionId, user, socketId)
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

  /**SQS 관련 작업, 추후 이전 예정 */
  private SQS_QUEUE_URL = process.env.SQS_URL
  private region = 'ap-northeast-2'
  private client = new SQSClient({ region: this.region })

  /*  await this.redis.set(`sessionId:${sessionId}`, null or '')*/
  async sendMessageToSqs(sessionId: string, sqsQueueUrl = this.SQS_QUEUE_URL) {
    const command = new SendMessageCommand({
      QueueUrl: sqsQueueUrl,
      MessageBody: 'this is Message Body 입니다.',
      MessageAttributes: {
        /**인프라와 상의필요 */
        sessionId: { DataType: 'String', StringValue: sessionId },
      },
    })
    this.client.send(command)
  }
}

/** SQS와 연결 시
 *  1.  const readyUsers = [...readyMales, ...readyFemales]
 *  readyUsers를 sessionId와 매칭
 *  setSessionIdToParticipant()같은거 만들기
 *
 *  2. sqs에 sessionId 전송
 *
 *  3. sessionId를 redis에 { `sessionId:${sessionId}`,null }꼴로 저장 후 구독
 *
 *  4. `sessionId:${sessionId}`항목이 변경되면 data 들고와서 clients에게 emit
 *  ㄴ sendTokenToParticipant()
 *
 *  await this.redis.set(`sessionId:${sessionId}`, null or '')
 */
