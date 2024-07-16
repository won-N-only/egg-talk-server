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

  // 남자와 여자사이에 친구 관계를 추가.
  /*
    남자 "John"과 여자 "Jane"이 친구라면, "John"의 친구 목록에 "Jane"을 추가하고, "Jane"의 친구 목록에 "John"을 추가합니다.
  */
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
  // 특정 남자의 친구 목록을 가져옴, John의 친구 목록을 알고 싶다면 string에 넣으면 됨
  getMaleNeighbors(male: string): Set<string> {
    return this.maleEdges.get(male) || new Set()
  }

  // 특정 여자의 친구 목록을 가져옴, Jane의 친구 목록을 알고 싶다면 string에 넣으면 됨
  getFemaleNeighbors(female: string): Set<string> {
    return this.femaleEdges.get(female) || new Set()
  }
  // 남자들 중에서 친구 관계가 있는 사람들의 이름을 모두 가져옵니다
  getMales(): string[] {
    return Array.from(this.maleEdges.keys())
  }
  // 여자들 중에서 친구 관계가 있는 사람들의 이름을 모두 가져옵니다
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
  // 참여자를 추가하는 함수입니다.
  async addParticipant(name: string, socket: Socket, gender: string) {
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
  }

  // 대기열에서 특정 참가자를 제거합니다. 성별과 이름으로 찾아서 제거하는 방식입니다.
  async removeParticipant(name: string, gender: string) {
    const genderQueue = gender === 'MALE' ? 'maleQueue' : 'femaleQueue'
    const queue = await this.redis.lrange(genderQueue, 0, -1)
    for (const item of queue) {
      const parsedItem = JSON.parse(item)
      if (parsedItem.name === name) {
        await this.redis.lrem(genderQueue, 0, item)
        break
      }
    }
  }

  //  새로운 세션 ID를 생성합니다.
  async findOrCreateNewSession(): Promise<string> {
    const newSessionId = this.sessionService.generateSessionId()
    await this.sessionService.createSession(newSessionId)
    console.log(`Creating and returning new session: ${newSessionId}`)
    return newSessionId
  }

  // 참가자가 대기열에 추가되면 매칭 가능한 그룹을 찾고, 찾았으면 세션을 시작합니다.
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
        this.sessionService.getParticipants(sessionId).map(p => p.name),
      )
      return { sessionId }
    } catch (error) {
      console.error('Error joining queue:', error)
      if (sessionId) {
        await this.sessionService.deleteSession(sessionId)
      }
    }
  }

  // 남자, 여자 대기열을 모두 확인해서 매칭 가능한 그룹을 찾음. 남자와 여자가 서로 친구가 아닌 경우에만 매칭을 시도함.
  // 매칭 가능한 그룹이 있으면 세션을 시작함.
  async filterQueues() {
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
      // BipartiteGraph 객체를 생성하여 남자와 여자 사이의 친구 관계를 그래프로 만듭니다. 친구가 아닌 경우에만 간선을 추가합니다.
      const graph = new BipartiteGraph()
      for (const male of maleQueue) {
        for (const female of femaleQueue) {
          if (!maleFriendsMap.get(male.name).has(female.name)) {
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
  // 매칭된 그룹을 대기열에서 제거. 남녀참가자를 대기열에서 찾아 제거해야함.
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

  // 각 참가자의 친구 목록을 가져와서 맵으로 만들어줌. 예를 들면 "John"의 친구 목록을 가져와서 "John"의 키로 매핑을 함
  private async buildFriendsMap(queue: { name: string; socketId: string }[]) {
    const friendsMap = new Map<string, Set<string>>()
    await Promise.all(
      queue.map(async participant => {
        const friends = await this.getFriends(participant.name)
        friendsMap.set(participant.name, new Set(friends))
      }),
    )
    console.log('Built friends map:', friendsMap)
    return friendsMap
  }

  // 친구 목록을 가져오게됨. 캐시에서 친구 목록을 찾고, 캐시에 없으면 데이터베이스를 뒤져서 친구 목록을 들고옴
  private async getFriends(name: string): Promise<string[]> {
    const cachedFriends = this.friendCache.get<string[]>(name)
    if (cachedFriends) {
      return cachedFriends
    }
    const friends = await this.commonService.sortFriend(name)
    this.friendCache.set(name, friends)
    return friends
  }

  //  남자와 여자가 서로 친구가 아닌 경우에만 매칭을 시도합니다. 매칭 가능한 그룹이 있으면 그룹의 이름과 소켓 ID를 반환합니다.
  private findMatchingGroups(
    graph: BipartiteGraph,
    maleFriendsMap: Map<string, Set<string>>,
    femaleFriendsMap: Map<string, Set<string>>,
    maleQueue: { name: string; socketId: string }[],
    femaleQueue: { name: string; socketId: string }[],
  ) {
    const males = graph.getMales()
    const females = graph.getFemales()

    console.log('Male nodes:', males)
    console.log('Female nodes:', females)
    // getCombinations 함수를 사용하여 가능한 모든 남자 그룹과 여자 그룹의 조합을 만듦
    const maleCombos = this.getCombinations(males, 3)
    const femaleCombos = this.getCombinations(females, 3)
    // 남자 그룹과 여자 그룹이 유효한지 확인합니다. 유효한 그룹이 있으면 그룹의 이름과 소켓 ID를 반환
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
    return null
  }

  private getCombinations(arr: string[], size: number): string[][] {
    const result: string[][] = []
    // 재귀적으로 조합을 생성하여 결과 배열에 추가합니다. 예를 들어, 5명 중 3명을 뽑는 모든 조합을 만듦
    // https://www.notion.so/queue-service-d93882ce399f4b6d9560f2e5335ed8c1 여기에 정리
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
    return result
  }

  private isGroupValid(
    males: string[],
    females: string[],
    graph: BipartiteGraph,
    maleFriendsMap: Map<string, Set<string>>,
    femaleFriendsMap: Map<string, Set<string>>,
  ): boolean {
    const allMales = new Set(males)
    const allFemales = new Set(females)
    // 각 남자의 친구 목록을 확인하여, 여자 그룹에 속한 여자가 친구 목록에 있는지 확인합니다. 친구가 있으면 유효하지 않은 그룹으로 판단합니다.
    for (const male of males) {
      const neighbors = graph.getMaleNeighbors(male)
      const maleFriends = maleFriendsMap.get(male) || new Set()

      for (const female of females) {
        if (!neighbors.has(female) || maleFriends.has(female)) {
          return false
        }
      }
    }
    // 각 여자의 친구 목록을 확인하여, 남자 그룹에 속한 남자가 친구 목록에 있는지 확인합니다. 친구가 있으면 유효하지 않은 그룹으로 판단합니다.
    for (const female of females) {
      const neighbors = graph.getFemaleNeighbors(female)
      const femaleFriends = femaleFriendsMap.get(female) || new Set()

      for (const male of males) {
        if (!neighbors.has(male) || femaleFriends.has(male)) {
          return false
        }
      }
    }

    // 모든 검증을 통과하면 유효한 그룹으로 판단하고 true를 반환합니다.
    return true
  }
}
