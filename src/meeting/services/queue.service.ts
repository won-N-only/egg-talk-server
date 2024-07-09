import { Injectable } from '@nestjs/common'
import { Socket } from 'socket.io'
import { MeetingService } from './meeting.service'

@Injectable()
export class QueueService {
  constructor(private readonly meetingService: MeetingService) {}
  private maleQueue: { name: string; socket: Socket }[] = []
  private femaleQueue: { name: string; socket: Socket }[] = []

  /* 참여자 대기열 추가 */
  addParticipant(name: string, socket: Socket, gender: string) {
    if (gender === 'MALE') {
      const index = this.maleQueue.findIndex(p => p.name === name)
      if (index !== -1) {
        // 기존 참가자를 제거
        this.maleQueue.splice(index, 1)
      }
      // 새로운 참가자 추가
      this.maleQueue.push({ name, socket })
      console.log(
        'male Queue : ',
        this.maleQueue.map(p => p.name),
      )
    } else if (gender === 'FEMALE') {
      const index = this.femaleQueue.findIndex(p => p.name === name)
      if (index !== -1) {
        // 기존 참가자를 제거
        this.femaleQueue.splice(index, 1)
      }
      // 새로운 참가자 추가
      this.femaleQueue.push({ name, socket })
      console.log(
        'female Queue : ',
        this.femaleQueue.map(p => p.name),
      )
    }
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
      this.addParticipant(participantName, client, gender)

      if (this.maleQueue.length >= 3 && this.femaleQueue.length >= 3) {
        sessionId = await this.findOrCreateNewSession()
        const readyMales = this.maleQueue.splice(0, 3)
        const readyFemales = this.femaleQueue.splice(0, 3)

        await this.meetingService.createSession(sessionId)

        readyMales.forEach(male => {
          this.meetingService.addParticipant(sessionId, male.name, male.socket)
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
