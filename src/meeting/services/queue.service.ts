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
      this.maleQueue.push({ name, socket })
      console.log(
        'male Queue : ',
        this.maleQueue.map(p => p.name),
      )
    } else if (gender === 'FEMALE') {
      this.femaleQueue.push({ name, socket })
      console.log(
        'female Queue : ',
        this.femaleQueue.map(p => p.name),
      )
    }
  }

  /* 참여자 대기열 삭제 */
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

  /* 남녀 3명씩 끊어서 처리하는 작업 */
  async handleJoinQueue(
    sessionName: string,
    participantName: string,
    client: Socket,
    gender: string,
  ) {
    try {
      this.addParticipant(participantName, client, gender)

      const readyMales = this.maleQueue
      const readyFemales = this.femaleQueue
      if (readyMales.length >= 3 && readyFemales.length >= 3) {
        await this.openviduService.createSession(sessionName)
        for (let i = 0; i < 3; i++) {
          this.openviduService.addParticipant(
            sessionName,
            readyMales[i].name,
            readyMales[i].socket,
          )
          this.openviduService.addParticipant(
            sessionName,
            readyFemales[i].name,
            readyFemales[i].socket,
          )
        }

        this.maleQueue.splice(0, 3)
        this.femaleQueue.splice(0, 3)
        await this.openviduService.startVideoChatSession(sessionName)
      }
      // 이 부분은 클라 확인차 로그로써 삭제해도 무방 다만 테스트 시 확인이 힘들어짐
      const participants = this.openviduService.getParticipants(sessionName)
      console.log(
        'Current waiting participants: ',
        participants.map(p => p.name),
      )
    } catch (error) {
      console.error('Error joining queue:', error)
      await this.openviduService.deleteSession(sessionName)
    }
  }
}
