import { Injectable } from '@nestjs/common'
import { Socket } from 'socket.io'
import { MeetingService } from './meeting.service'
import { CommonService } from '../../common/common.service'
import * as NodeCache from 'node-cache'
import { performance } from 'perf_hooks'

class BipartiteGraph {
  private maleEdges: Map<string, Set<string>> = new Map()
  private femaleEdges: Map<string, Set<string>> = new Map()

  addEdge(male: string, female: string) {
    if (!this.maleEdges.has(male)) {
      this.maleEdges.set(male, new Set())
    }
    this.maleEdges.get(male).add(female)

    if (!this.femaleEdges.has(female)) {
      this.femaleEdges.set(female, new Set())
    }
    this.femaleEdges.get(female).add(male)
  }

  getMaleNeighbors(male: string): Set<string> {
    return this.maleEdges.get(male) || new Set()
  }

  getFemaleNeighbors(female: string): Set<string> {
    return this.femaleEdges.get(female) || new Set()
  }

  getMales(): string[] {
    return Array.from(this.maleEdges.keys())
  }

  getFemales(): string[] {
    return Array.from(this.femaleEdges.keys())
  }
}

@Injectable()
export class QueueService {
  private maleQueue: { name: string; socket: Socket }[] = []
  private femaleQueue: { name: string; socket: Socket }[] = []
  private friendCache = new NodeCache({ stdTTL: 600 })

  constructor(
    private readonly meetingService: MeetingService,
    private readonly commonService: CommonService,
  ) {}

  async addParticipant(name: string, socket: Socket, gender: string) {
    const start = performance.now()
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
    const end = performance.now()
    console.log(`addParticipant 실행 시간: ${(end - start).toFixed(2)}ms`)
  }

  removeParticipant(name: string, gender: string) {
    const start = performance.now()
    const queue = gender === 'MALE' ? this.maleQueue : this.femaleQueue
    this[`${gender.toLowerCase()}Queue`] = queue.filter(p => p.name !== name)
    console.log(
      `Update ${gender} Queue: `,
      this[`${gender.toLowerCase()}Queue`].map(p => p.name),
    )
    const end = performance.now()
    console.log(`removeParticipant 실행 시간: ${(end - start).toFixed(2)}ms`)
  }

  async findOrCreateNewSession(): Promise<string> {
    const start = performance.now()
    const newSessionId = this.meetingService.generateSessionId()
    await this.meetingService.createSession(newSessionId)
    console.log(`Creating and returning new session: ${newSessionId}`)
    const end = performance.now()
    console.log(
      `findOrCreateNewSession 실행 시간: ${(end - start).toFixed(2)}ms`,
    )
    return newSessionId
  }

  async handleJoinQueue(
    participantName: string,
    client: Socket,
    gender: string,
  ) {
    let sessionId = ''
    try {
      const start = performance.now()
      await this.addParticipant(participantName, client, gender)

      const result = await this.filterQueues()
      if (result) {
        const { sessionId, readyMales, readyFemales } = result
        const end = performance.now()
        console.log(`handleJoinQueue 실행 시간: ${(end - start).toFixed(2)}ms`)
        return { sessionId, readyMales, readyFemales }
      }

      console.log(
        'Current waiting participants: ',
        this.meetingService.getParticipants(sessionId).map(p => p.name),
      )
      const end = performance.now()
      console.log(`handleJoinQueue 실행 시간: ${(end - start).toFixed(2)}ms`)
      return { sessionId }
    } catch (error) {
      console.error('Error joining queue:', error)
      if (sessionId) {
        await this.meetingService.deleteSession(sessionId)
      }
    }
  }

  async filterQueues() {
    const start = performance.now()
    if (this.maleQueue.length >= 3 && this.femaleQueue.length >= 3) {
      console.log('Attempting to filter queues for matching...')
      const [maleFriendsMap, femaleFriendsMap] = await Promise.all([
        this.buildFriendsMap(this.maleQueue),
        this.buildFriendsMap(this.femaleQueue),
      ])

      const graph = new BipartiteGraph()
      for (const male of this.maleQueue) {
        for (const female of this.femaleQueue) {
          if (
            !maleFriendsMap.get(male.name).has(female.name) &&
            !femaleFriendsMap.get(female.name).has(male.name)
          ) {
            graph.addEdge(male.name, female.name)
          }
        }
      }

      const result = this.findMatchingGroups(
        graph,
        maleFriendsMap,
        femaleFriendsMap,
      )

      if (result) {
        const { males, females } = result

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

        const end = performance.now()
        console.log(`filterQueues 실행 시간: ${(end - start).toFixed(2)}ms`)
        return {
          sessionId,
          readyMales: males,
          readyFemales: females,
        }
      }

      console.log('Not enough matched participants to start a session.')
    } else {
      console.log('Not enough participants in both queues to start matching.')
    }
    const end = performance.now()
    console.log(`filterQueues 실행 시간: ${(end - start).toFixed(2)}ms`)
    return null
  }

  private async buildFriendsMap(queue: { name: string; socket: Socket }[]) {
    const start = performance.now()
    const friendsMap = new Map<string, Set<string>>()
    await Promise.all(
      queue.map(async participant => {
        const friends = await this.getFriends(participant.name)
        friendsMap.set(participant.name, new Set(friends))
      }),
    )
    console.log('Built friends map:', friendsMap)
    const end = performance.now()
    console.log(`buildFriendsMap 실행 시간: ${(end - start).toFixed(2)}ms`)
    return friendsMap
  }

  private async getFriends(name: string): Promise<string[]> {
    const start = performance.now()
    const cachedFriends = this.friendCache.get<string[]>(name)
    if (cachedFriends) {
      console.log(`Cache hit for friends of ${name}`)
      const end = performance.now()
      console.log(
        `getFriends (cache hit) 실행 시간: ${(end - start).toFixed(2)}ms`,
      )
      return cachedFriends
    }
    console.log(
      `Cache miss for friends of ${name}, fetching from commonService`,
    )
    const friends = await this.commonService.sortFriend(name)
    this.friendCache.set(name, friends)
    const end = performance.now()
    console.log(
      `getFriends (cache miss) 실행 시간: ${(end - start).toFixed(2)}ms`,
    )
    return friends
  }

  private findMatchingGroups(
    graph: BipartiteGraph,
    maleFriendsMap: Map<string, Set<string>>,
    femaleFriendsMap: Map<string, Set<string>>,
  ) {
    const start = performance.now()
    const males = graph.getMales()
    const females = graph.getFemales()

    console.log('Male nodes:', males)
    console.log('Female nodes:', females)

    const maleCombos = this.getCombinations(males, 3)
    const femaleCombos = this.getCombinations(females, 3)

    for (const maleGroup of maleCombos) {
      for (const femaleGroup of femaleCombos) {
        if (
          this.isGroupValid(
            maleGroup,
            femaleGroup,
            graph,
            maleFriendsMap,
            femaleFriendsMap,
          )
        ) {
          const end = performance.now()
          console.log(
            `findMatchingGroups 실행 시간: ${(end - start).toFixed(2)}ms`,
          )
          return {
            males: maleGroup.map(name => ({
              name,
              socket: this.maleQueue.find(p => p.name === name).socket,
            })),
            females: femaleGroup.map(name => ({
              name,
              socket: this.femaleQueue.find(p => p.name === name).socket,
            })),
          }
        }
      }
    }
    const end = performance.now()
    console.log(`findMatchingGroups 실행 시간: ${(end - start).toFixed(2)}ms`)
    return null
  }

  private getCombinations(arr: string[], size: number): string[][] {
    const start = performance.now()
    const result: string[][] = []
    const combine = (start: number, chosen: string[]) => {
      if (chosen.length === size) {
        result.push([...chosen])
        return
      }
      for (let i = start; i < arr.length; i++) {
        chosen.push(arr[i])
        combine(i + 1, chosen)
        chosen.pop()
      }
    }
    combine(0, [])
    const end = performance.now()
    console.log(`getCombinations 실행 시간: ${(end - start).toFixed(2)}ms`)
    return result
  }

  private isGroupValid(
    males: string[],
    females: string[],
    graph: BipartiteGraph,
    maleFriendsMap: Map<string, Set<string>>,
    femaleFriendsMap: Map<string, Set<string>>,
  ): boolean {
    const start = performance.now()
    const allMales = new Set(males)
    const allFemales = new Set(females)

    for (const male of males) {
      const neighbors = graph.getMaleNeighbors(male)
      const maleFriends = maleFriendsMap.get(male) || new Set()

      for (const female of females) {
        if (!neighbors.has(female) || maleFriends.has(female)) {
          const end = performance.now()
          console.log(`isGroupValid 실행 시간: ${(end - start).toFixed(2)}ms`)
          return false
        }
      }
    }

    for (const female of females) {
      const neighbors = graph.getFemaleNeighbors(female)
      const femaleFriends = femaleFriendsMap.get(female) || new Set()

      for (const male of males) {
        if (!neighbors.has(male) || femaleFriends.has(male)) {
          const end = performance.now()
          console.log(`isGroupValid 실행 시간: ${(end - start).toFixed(2)}ms`)
          return false
        }
      }
    }

    const end = performance.now()
    console.log(`isGroupValid 실행 시간: ${(end - start).toFixed(2)}ms`)
    return true
  }
}
