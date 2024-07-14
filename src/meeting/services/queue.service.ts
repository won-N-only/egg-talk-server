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
      console.log('Attempting to filter queues for matching...')
      const maleFriendsMap = await this.buildFriendsMap(this.maleQueue)
      const femaleFriendsMap = await this.buildFriendsMap(this.femaleQueue)

      const maleCombinations = this.getCombinations(this.maleQueue, 3)
      const femaleCombinations = this.getCombinations(this.femaleQueue, 3)

      for (const males of maleCombinations) {
        for (const females of femaleCombinations) {
          if (
            this.noCommonFriends(
              males,
              females,
              maleFriendsMap,
              femaleFriendsMap,
            )
          ) {
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
              m => !males.map(male => male.name).includes(m.name),
            )
            this.femaleQueue = this.femaleQueue.filter(
              f => !females.map(female => female.name).includes(f.name),
            )

            return {
              sessionId,
              readyMales: males,
              readyFemales: females,
            }
          }
        }
      }
      console.log('Not enough matched participants to start a session.')
    } else {
      console.log('Not enough participants in both queues to start matching.')
    }
    return null
  }

  private async buildFriendsMap(queue: { name: string; socket: Socket }[]) {
    const friendsMap = new Map<string, Set<string>>()
    for (const participant of queue) {
      const friends = await this.getFriends(participant.name)
      friendsMap.set(participant.name, new Set(friends))
    }
    console.log('Built friends map:', friendsMap)
    return friendsMap
  }

  private async getFriends(name: string): Promise<string[]> {
    const cachedFriends = this.friendCache.get<string[]>(name)
    if (cachedFriends) {
      console.log(`Cache hit for friends of ${name}`)
      return cachedFriends
    }
    console.log(
      `Cache miss for friends of ${name}, fetching from commonService`,
    )
    const friends = await this.commonService.sortFriend(name)
    this.friendCache.set(name, friends)
    return friends
  }

  private getCombinations(
    queue: { name: string; socket: Socket }[],
    size: number,
  ) {
    const result: { name: string; socket: Socket }[][] = []
    const f = (start: number, combo: { name: string; socket: Socket }[]) => {
      if (combo.length === size) {
        result.push(combo)
        return
      }
      for (let i = start; i < queue.length; i++) {
        f(i + 1, combo.concat(queue[i]))
      }
    }
    f(0, [])
    return result
  }

  private noCommonFriends(
    males: { name: string; socket: Socket }[],
    females: { name: string; socket: Socket }[],
    maleFriendsMap: Map<string, Set<string>>,
    femaleFriendsMap: Map<string, Set<string>>,
  ): boolean {
    for (const male of males) {
      const maleFriends = maleFriendsMap.get(male.name) || new Set()
      for (const female of females) {
        if (maleFriends.has(female.name)) {
          return false
        }
      }
    }
    for (const female of females) {
      const femaleFriends = femaleFriendsMap.get(female.name) || new Set()
      for (const male of males) {
        if (femaleFriends.has(male.name)) {
          return false
        }
      }
    }
    return true
  }
}
