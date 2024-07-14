import { Injectable } from '@nestjs/common'
import { Socket } from 'socket.io'
import { MeetingService } from './meeting.service'
import { CommonService } from '../../common/common.service'
import * as NodeCache from 'node-cache'

class BipartiteGraph {
  private edges: Map<string, Set<string>> = new Map()

  addEdge(male: string, female: string) {
    if (!this.edges.has(male)) {
      this.edges.set(male, new Set())
    }
    this.edges.get(male).add(female)
  }

  getNeighbors(node: string): Set<string> {
    return this.edges.get(node) || new Set()
  }

  getNodes(): string[] {
    return Array.from(this.edges.keys())
  }
}

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

      const result = this.findMatchingGroups(graph)

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

  private findMatchingGroups(graph: BipartiteGraph) {
    const males = graph.getNodes()
    const females = Array.from(
      new Set(
        [].concat(...males.map(male => Array.from(graph.getNeighbors(male)))),
      ),
    )

    console.log('Male nodes:', males)
    console.log('Female nodes:', females)

    for (let i = 0; i < males.length - 2; i++) {
      for (let j = i + 1; j < males.length - 1; j++) {
        for (let k = j + 1; k < males.length; k++) {
          const maleGroup = [males[i], males[j], males[k]]

          for (let a = 0; a < females.length - 2; a++) {
            for (let b = a + 1; b < females.length - 1; b++) {
              for (let c = b + 1; c < females.length; c++) {
                const femaleGroup = [females[a], females[b], females[c]]

                if (this.isGroupValid(maleGroup, femaleGroup, graph)) {
                  return {
                    males: maleGroup.map(name => ({
                      name,
                      socket: this.maleQueue.find(p => p.name === name).socket,
                    })),
                    females: femaleGroup.map(name => ({
                      name,
                      socket: this.femaleQueue.find(p => p.name === name)
                        .socket,
                    })),
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

  private isGroupValid(
    males: string[],
    females: string[],
    graph: BipartiteGraph,
  ): boolean {
    for (const male of males) {
      const neighbors = graph.getNeighbors(male)
      for (const female of females) {
        if (!neighbors.has(female)) {
          return false
        }
      }
    }
    return true
  }
}
