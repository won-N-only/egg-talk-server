import { Injectable } from '@nestjs/common'
import { Socket } from 'socket.io'
import { MeetingService } from './meeting.service'
import { CommonService } from '../../common/common.service'
import * as NodeCache from 'node-cache'

@Injectable()
export class QueueService {
  private maleQueue: { name: string; socket: Socket }[] = []
  private femaleQueue: { name: string; socket: Socket }[] = []
  private friendCache = new NodeCache({ stdTTL: 600 }) // 캐시 TTL 10분

  constructor(
    private readonly meetingService: MeetingService,
    private readonly commonService: CommonService,
  ) {}

  async addParticipant(name: string, socket: Socket, gender: string) {
    const queue = gender === 'MALE' ? this.maleQueue : this.femaleQueue
    const index = queue.findIndex(p => p.name === name)
    if (index !== -1) {
      queue.splice(index, 1)
    }
    queue.push({ name, socket })
    console.log(
      `${gender} Queue: `,
      queue.map(p => p.name),
    )
    await this.filterQueues()
  }

  removeParticipant(name: string, gender: string) {
    const queue = gender === 'MALE' ? this.maleQueue : this.femaleQueue
    this[`${gender.toLowerCase()}Queue`] = queue.filter(p => p.name !== name)
    console.log(
      `Update ${gender} Queue: `,
      this[`${gender.toLowerCase()}Queue`].map(p => p.name),
    )
  }

  async findOrCreateNewSession(): Promise<string> {
    const newSessionId = this.meetingService.generateSessionId()
    await this.meetingService.createSession(newSessionId)
    console.log(`Creating and returning new session: ${newSessionId}`)
    return newSessionId
  }

  async handleJoinQueue(
    participantName: string,
    client: Socket,
    gender: string,
  ) {
    let sessionId = ''
    try {
      await this.addParticipant(participantName, client, gender)

      const result = await this.filterQueues()
      if (result) {
        const { sessionId, readyMales, readyFemales } = result
        return { sessionId, readyMales, readyFemales }
      }

      console.log(
        'Current waiting participants: ',
        this.meetingService.getParticipants(sessionId).map(p => p.name),
      )
      return { sessionId }
    } catch (error) {
      console.error('Error joining queue:', error)
      if (sessionId) {
        await this.meetingService.deleteSession(sessionId)
      }
    }
  }

  async filterQueues() {
    if (this.maleQueue.length >= 3 && this.femaleQueue.length >= 3) {
      const maleCombinations = this.getCombinations(this.maleQueue, 3)
      const femaleCombinations = this.getCombinations(this.femaleQueue, 3)

      for (const males of maleCombinations) {
        const maleFriends = await Promise.all(
          males.map(m => this.getFriends(m.name)),
        )
        const flatMaleFriends = maleFriends.flat()

        for (const females of femaleCombinations) {
          const femaleNames = females.map(f => f.name)

          if (flatMaleFriends.every(friend => !femaleNames.includes(friend))) {
            const sessionId = await this.findOrCreateNewSession()

            await Promise.all([
              ...males.map(male =>
                this.meetingService.addParticipant(
                  sessionId,
                  male.name,
                  male.socket,
                ),
              ),
              ...females.map(female =>
                this.meetingService.addParticipant(
                  sessionId,
                  female.name,
                  female.socket,
                ),
              ),
            ])

            console.log('현재 큐 시작진입합니다 세션 이름은: ', sessionId)
            await this.meetingService.startVideoChatSession(sessionId)

            this.maleQueue = this.maleQueue.filter(
              m => !males.map(rm => rm.name).includes(m.name),
            )
            this.femaleQueue = this.femaleQueue.filter(
              f => !females.map(rf => rf.name).includes(f.name),
            )

            return { sessionId, readyMales: males, readyFemales: females }
          }
        }
      }
    }
    return null
  }

  private getCombinations(arr, size) {
    const result = []
    const f = (prefix, arr) => {
      for (let i = 0; i < arr.length; i++) {
        const newPrefix = prefix.concat(arr[i])
        if (newPrefix.length === size) {
          result.push(newPrefix)
        } else {
          f(newPrefix, arr.slice(i + 1))
        }
      }
    }
    f([], arr)
    return result
  }

  private async getFriends(name: string): Promise<string[]> {
    const cachedFriends = this.friendCache.get<string[]>(name)
    if (cachedFriends) {
      return cachedFriends
    }
    const friends = await this.commonService.sortFriend(name)
    this.friendCache.set(name, friends)
    return friends
  }
}
