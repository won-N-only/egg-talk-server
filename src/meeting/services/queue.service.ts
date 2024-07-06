import { Injectable } from '@nestjs/common'
import { Socket } from 'socket.io'
import { OpenViduService } from './meeting.service'

@Injectable()
export class QueueService {
  constructor(private readonly openviduService: OpenViduService) {}
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
    const newSessionName = this.openviduService.generateSessionName()
    await this.openviduService.createSession(newSessionName)
    console.log(`Creating and returning new session: ${newSessionName}`)
    return newSessionName
  }

  /* 남녀 3명씩 끊어서 처리하는 작업 */
  async handleJoinQueue(
    participantName: string,
    client: Socket,
    gender: string,
  ) {
    let sessionName = ''
    try {
      this.addParticipant(participantName, client, gender)

      if (this.maleQueue.length >= 3 && this.femaleQueue.length >= 3) {
        sessionName = await this.findOrCreateNewSession()
        const readyMales = this.maleQueue.splice(0, 3)
        const readyFemales = this.femaleQueue.splice(0, 3)

        await this.openviduService.createSession(sessionName)

        readyMales.forEach(male => {
          this.openviduService.addParticipant(
            sessionName,
            male.name,
            male.socket,
          )
        })

        readyFemales.forEach(female => {
          this.openviduService.addParticipant(
            sessionName,
            female.name,
            female.socket,
          )
        })
        await this.openviduService.startVideoChatSession(sessionName)
        return { sessionName, readyMales, readyFemales }
      }
      // 이 부분은 클라 확인차 로그로써 삭제해도 무방 다만 테스트 시 확인이 힘들어짐
      const participants = this.openviduService.getParticipants(sessionName)
      console.log(
        'Current waiting participants: ',
        participants.map(p => p.name),
      )
      return { sessionName }
    } catch (error) {
      console.error('Error joining queue:', error)
      await this.openviduService.deleteSession(sessionName)
    }
  }
}
