import { Injectable, Inject } from '@nestjs/common'
import { Socket } from 'socket.io'
import { MeetingService } from './meeting.service'
import { CommonService } from '../../common/common.service'
import * as NodeCache from 'node-cache'
import { performance } from 'perf_hooks'
import { Redis } from 'ioredis'
import { SessionService } from './session.service'

class BipartiteGraph {
  private maleEdges: Map<string, Set<string>> = new Map()
  private femaleEdges: Map<string, Set<string>> = new Map()

  addEdge(male: string, female: string) {
    if (!this.maleEdges.has(male)) {
      this.maleEdges.set(male, new Set())
    }
    this.maleEdges.get(male)!.add(female)

    if (!this.femaleEdges.has(female)) {
      this.femaleEdges.set(female, new Set())
    }
    this.femaleEdges.get(female)!.add(male)
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
  private redis: Redis
  public userQueueCount = 3
  private friendCache = new NodeCache({ stdTTL: 600 })

  constructor(
    private readonly meetingService: MeetingService,
    private readonly commonService: CommonService,
    private readonly sessionService: SessionService,
    @Inject('REDIS') redis: Redis,
  ) {
    this.redis = redis
  }

  async addParticipant(name: string, socket: Socket, gender: string) {
    const start = performance.now()
    const participant = JSON.stringify({ name, socketId: socket.id })
    const genderQueue = gender === 'MALE' ? 'maleQueue' : 'femaleQueue'

    const queue = await this.redis.lrange(genderQueue, 0, -1)

    for (const item of queue) {
      const parsedItem = JSON.parse(item)
      if (parsedItem.name === name) {
        await this.redis.lrem(genderQueue, 0, item)
      }
    }

    await this.redis.rpush(genderQueue, participant)
    console.log(
      `${gender} Queue: `,
      (await this.redis.lrange(genderQueue, 0, -1)).map(
        item => JSON.parse(item).name,
      ),
    )
    await this.filterQueues()
    const end = performance.now()
    console.log(`addParticipant 실행 시간: ${(end - start).toFixed(2)}ms`)
  }

  async removeParticipant(name: string, gender: string) {
    const start = performance.now()
    const genderQueue = gender === 'MALE' ? 'maleQueue' : 'femaleQueue'
    const queue = await this.redis.lrange(genderQueue, 0, -1)
    for (const item of queue) {
      const parsedItem = JSON.parse(item)
      if (parsedItem.name === name) {
        await this.redis.lrem(genderQueue, 0, item)
        break
      }
    }
    const end = performance.now()
    console.log(`removeParticipant 실행 시간: ${(end - start).toFixed(2)}ms`)
  }

  async findOrCreateNewSession(): Promise<string> {
    const start = performance.now()
    const newSessionId = this.sessionService.generateSessionId()
    await this.sessionService.createSession(newSessionId)
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
        this.sessionService.getParticipants(sessionId).map(p => p.name),
      )
      const end = performance.now()
      console.log(`handleJoinQueue 실행 시간: ${(end - start).toFixed(2)}ms`)
      return { sessionId }
    } catch (error) {
      console.error('Error joining queue:', error)
      if (sessionId) {
        await this.sessionService.deleteSession(sessionId)
      }
    }
  }

  async filterQueues() {
    const start = performance.now()
    const maleQueue = (await this.redis.lrange('maleQueue', 0, -1)).map(item =>
      JSON.parse(item),
    )
    const femaleQueue = (await this.redis.lrange('femaleQueue', 0, -1)).map(
      item => JSON.parse(item),
    )

    if (maleQueue.length >= 3 && femaleQueue.length >= 3) {
      console.log('Attempting to filter queues for matching...')
      const [maleFriendsMap, femaleFriendsMap] = await Promise.all([
        this.buildFriendsMap(maleQueue),
        this.buildFriendsMap(femaleQueue),
      ])

      const graph = new BipartiteGraph()
      for (const male of maleQueue) {
        for (const female of femaleQueue) {
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
        maleQueue,
        femaleQueue,
      )

      if (result) {
        const { males, females } = result

        const sessionId = await this.findOrCreateNewSession()

        await Promise.all([
          ...males.map(male =>
            this.sessionService.addParticipant(
              sessionId,
              male.name,
              male.socketId,
            ),
          ),
          ...females.map(female =>
            this.sessionService.addParticipant(
              sessionId,
              female.name,
              female.socketId,
            ),
          ),
        ])

        console.log('Starting session with id: ', sessionId)
        await this.meetingService.startVideoChatSession(sessionId)

        await this.updateQueuesAfterMatch(males, females)

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

  private async updateQueuesAfterMatch(
    males: { name: string; socketId: string }[],
    females: { name: string; socketId: string }[],
  ) {
    const maleQueue = await this.redis.lrange('maleQueue', 0, -1)
    const femaleQueue = await this.redis.lrange('femaleQueue', 0, -1)

    for (const male of males) {
      await this.redis.lrem(
        'maleQueue',
        0,
        JSON.stringify({ name: male.name, socketId: male.socketId }),
      )
    }
    for (const female of females) {
      await this.redis.lrem(
        'femaleQueue',
        0,
        JSON.stringify({ name: female.name, socketId: female.socketId }),
      )
    }
  }

  private async buildFriendsMap(queue: { name: string; socketId: string }[]) {
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
    maleQueue: { name: string; socketId: string }[],
    femaleQueue: { name: string; socketId: string }[],
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
              socketId: maleQueue.find(p => p.name === name).socketId,
            })),
            females: femaleGroup.map(name => ({
              name,
              socketId: femaleQueue.find(p => p.name === name).socketId,
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
