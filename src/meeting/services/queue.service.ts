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
      const maleFriendsMap = await this.buildFriendsMap(this.maleQueue)
      const femaleFriendsMap = await this.buildFriendsMap(this.femaleQueue)

      // 남성 및 여성 큐를 친구 관계의 수로 정렬
      const sortedMaleQueue = this.maleQueue
        .slice()
        .sort(
          (a, b) =>
            (maleFriendsMap.get(a.name) || []).length -
            (maleFriendsMap.get(b.name) || []).length,
        )
      const sortedFemaleQueue = this.femaleQueue
        .slice()
        .sort(
          (a, b) =>
            (femaleFriendsMap.get(a.name) || []).length -
            (femaleFriendsMap.get(b.name) || []).length,
        )

      for (let i = 0; i < sortedMaleQueue.length - 2; i++) {
        for (let j = i + 1; j < sortedMaleQueue.length - 1; j++) {
          for (let k = j + 1; k < sortedMaleQueue.length; k++) {
            const males = [
              sortedMaleQueue[i],
              sortedMaleQueue[j],
              sortedMaleQueue[k],
            ]
            const maleNames = males.map(m => m.name)

            for (let a = 0; a < sortedFemaleQueue.length - 2; a++) {
              for (let b = a + 1; b < sortedFemaleQueue.length - 1; b++) {
                for (let c = b + 1; c < sortedFemaleQueue.length; c++) {
                  const females = [
                    sortedFemaleQueue[a],
                    sortedFemaleQueue[b],
                    sortedFemaleQueue[c],
                  ]
                  const femaleNames = females.map(f => f.name)

                  if (
                    this.noCommonFriends(
                      maleNames,
                      femaleNames,
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

                    console.log(
                      '현재 큐 시작진입합니다 세션 이름은: ',
                      sessionId,
                    )
                    await this.meetingService.startVideoChatSession(sessionId)

                    this.maleQueue = this.maleQueue.filter(
                      m => !maleNames.includes(m.name),
                    )
                    this.femaleQueue = this.femaleQueue.filter(
                      f => !femaleNames.includes(f.name),
                    )

                    return {
                      sessionId,
                      readyMales: males,
                      readyFemales: females,
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
    return null
  }

  private async buildFriendsMap(queue: { name: string; socket: Socket }[]) {
    const friendsMap = new Map<string, string[]>()
    for (const participant of queue) {
      const friends = await this.getFriends(participant.name)
      friendsMap.set(participant.name, friends)
    }
    return friendsMap
  }

  private noCommonFriends(
    maleNames: string[],
    femaleNames: string[],
    maleFriendsMap: Map<string, string[]>,
    femaleFriendsMap: Map<string, string[]>,
  ): boolean {
    for (const male of maleNames) {
      const maleFriends = maleFriendsMap.get(male) || []
      for (const female of femaleNames) {
        if (maleFriends.includes(female)) {
          return false
        }
      }
    }
    for (const female of femaleNames) {
      const femaleFriends = femaleFriendsMap.get(female) || []
      for (const male of maleNames) {
        if (femaleFriends.includes(male)) {
          return false
        }
      }
    }
    return true
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
