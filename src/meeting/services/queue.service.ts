import { Injectable } from '@nestjs/common'
import { Socket } from 'socket.io'
import { MeetingService } from './meeting.service'
import { CommonRepository } from '../../common/common.repository'

@Injectable()
export class QueueService {
  constructor(
    private readonly meetingService: MeetingService,
    private readonly commonRepository: CommonRepository,
  ) {}

  private maleQueue: { name: string; socket: Socket }[] = []
  private femaleQueue: { name: string; socket: Socket }[] = []

  async addParticipant(name: string, socket: Socket, gender: string) {
    const index = (
      gender === 'MALE' ? this.maleQueue : this.femaleQueue
    ).findIndex(p => p.name === name)
    if (index !== -1) {
      // 기존 참가자를 제거하고 새로운 참가자로 덮어씁니다.
      ;(gender === 'MALE' ? this.maleQueue : this.femaleQueue).splice(index, 1)
    }

    // 새로운 참가자 추가
    ;(gender === 'MALE' ? this.maleQueue : this.femaleQueue).push({
      name,
      socket,
    })
    console.log(
      `${gender} Queue: `,
      (gender === 'MALE' ? this.maleQueue : this.femaleQueue).map(p => p.name),
    )
  }

  removeParticipant(name: string, gender: string) {
    switch (gender) {
      case 'MALE':
        this.maleQueue = this.maleQueue.filter(p => p.name !== name)
        console.log(
          'Update Male Queue : ',
          this.maleQueue.map(p => p.name),
        )
        break

      case 'FEMALE':
        this.femaleQueue = this.femaleQueue.filter(p => p.name !== name)
        console.log(
          'Update Female Queue : ',
          this.femaleQueue.map(p => p.name),
        )
        break
      default:
        console.error('성별 오류입니다.')
        break
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

      // 큐 필터링 및 매칭 시도
      const result = await this.filterQueues()
      if (result) {
        const { sessionId, readyMales, readyFemales } = result
        return { sessionId, readyMales, readyFemales }
      }

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

  async filterQueues() {
    // 매칭 가능성 확인
    if (this.maleQueue.length >= 3 && this.femaleQueue.length >= 3) {
      for (let i = 0; i < this.maleQueue.length; i++) {
        console.log('------------------------', i, '번째')
        const male = this.maleQueue[i]
        console.log('male => ', male)
        const maleFriends = await this.commonRepository.getFriendNicknames(
          male.name,
        )
        console.log('maleFriends => ', maleFriends)
        const potentialFemales = this.femaleQueue.filter(
          female => !maleFriends.includes(female.name),
        )
        console.log('potentialFemales => ', potentialFemales)

        if (potentialFemales.length >= 3) {
          const readyMales = [male]
          console.log('readyMales => ', readyMales)
          const readyFemales = potentialFemales.slice(0, 3)
          console.log('readyFemales => ', readyFemales)
          const remainingMales = this.maleQueue.filter(
            m => m.name !== male.name,
          )
          console.log('remainingMales => ', remainingMales)
          const remainingFemales = this.femaleQueue.filter(
            f => !readyFemales.includes(f),
          )

          console.log('remainingFemales => ', remainingFemales)
          // 남은 남성 큐에서 추가로 2명 선택
          const additionalMales = remainingMales.slice(0, 2)
          console.log('additionalMales => ', additionalMales)
          readyMales.push(...additionalMales)
          console.log('readyMales => ', readyMales)
          this.maleQueue = remainingMales.slice(2)
          console.log('this.maleQueue => ', this.maleQueue)
          this.femaleQueue = remainingFemales
          console.log('this.femaleQueue => ', this.femaleQueue)

          const sessionId = await this.findOrCreateNewSession()

          readyMales.forEach(male => {
            this.meetingService.addParticipant(
              sessionId,
              male.name,
              male.socket,
            )
          })

          readyFemales.forEach(female => {
            this.meetingService.addParticipant(
              sessionId,
              female.name,
              female.socket,
            )
          })

          console.log('현재 큐 시작진입합니다 세션 이름은 : ', sessionId)
          await this.meetingService.startVideoChatSession(sessionId)

          return { sessionId, readyMales, readyFemales }
        } else {
          return
        }
      }
    }
    return null
  }
}
