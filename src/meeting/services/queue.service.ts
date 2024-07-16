import { Injectable, Inject } from '@nestjs/common'
import { MeetingService } from './meeting.service'
import Redis from 'ioredis'
import { SessionService } from './session.service'
import { SendMessageCommand, SQSClient } from '@aws-sdk/client-sqs'

@Injectable()
export class QueueService {
  public userQueueCount = 3
  constructor(
    private readonly meetingService: MeetingService,
    private readonly sessionService: SessionService,
    @Inject('REDIS') private readonly redis: Redis,
  ) {}

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

  /* 남녀 3명씩 끊어서 처리하는 작업 */
  async handleJoinQueue(
    participantName: string,
    gender: string,
  ): Promise<{ sessionId: string; readyUsers?: string[] }> {
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
        const readyUsers = [...maleQueue, ...femaleQueue]

        await this.redis.ltrim('maleQueue', this.userQueueCount, -1)
        await this.redis.ltrim('femaleQueue', this.userQueueCount, -1)

        sessionId = await this.sessionService.generateSessionId()

        console.log('현재 큐 시작진입합니다 세션 이름은 : ', sessionId)
        this.sessionService.initSession(sessionId)
        for (const user of readyUsers) {
          const socketId =
            await this.meetingService.getSocketIdByParticipantName(user)
          this.sessionService.addParticipant(sessionId, user, socketId)
        }

        await this.redis.set(`sessionId:${sessionId}:openViduUrl`, null)
        await this.sendMessageToSqs(sessionId, this.SQS_URL)

        return { sessionId, readyUsers }
      }

      return { sessionId }
    } catch (error) {
      console.error('Error joining queue:', error)
      await this.sessionService.deleteSession(sessionId)
    }
  }

  /**SQS 작업 */
  private SQS_URL = process.env.SQS_URL
  private region = 'ap-northeast-2'
  private client = new SQSClient({ region: this.region })

  async sendMessageToSqs(sessionId: string, sqsQueueUrl = this.SQS_URL) {
    const command = new SendMessageCommand({
      QueueUrl: sqsQueueUrl,
      MessageBody: 'this is Message Body 입니다.',
      MessageAttributes: {
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
