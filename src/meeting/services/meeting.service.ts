import { Injectable } from '@nestjs/common'
import { OpenVidu, OpenViduRole, Session } from 'openvidu-node-client'
import { Server } from 'socket.io'
import { v4 as uuidv4 } from 'uuid'
import Redis from 'ioredis'

type ChooseResult = {
  sender: string
  receiver: string
}

@Injectable()
export class MeetingService {
  private openvidu: OpenVidu
  public server: Server

  private redis: Redis

  constructor() {
    const OPENVIDU_URL = process.env.OPENVIDU_URL
    const OPENVIDU_SECRET = process.env.OPENVIDU_SECRET
    this.openvidu = new OpenVidu(OPENVIDU_URL, OPENVIDU_SECRET)

    this.redis = new Redis({
      host: process.env.REDIS_HOST,
      port: parseInt(process.env.REDIS_PORT, 10),
    })
  }

  private shuffleArray<T>(array: T[]): T[] {
    for (let i = array.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1))
      ;[array[i], array[j]] = [array[j], array[i]]
    }
    return array
  }

  generateSessionId() {
    return uuidv4()
  }

  // 소켓 관리
  async getParticipantNameBySocketId(socketId: string): Promise<string | null> {
    return await this.redis.get(`socket:${socketId}:participantName`)
  }

  async setConnectedSocket(
    participantName: string,
    clientId: string,
  ): Promise<void> {
    await this.redis.set(`socket:${clientId}:participantName`, participantName)
  }

  async deleteConnectedSocket(socketId: string): Promise<void> {
    await this.redis.del(`socket:${socketId}:participantName`)
  }

  // 세션 관리
  async getSessionIdByParticipantName(
    participantName: string,
  ): Promise<string | null> {
    return await this.redis.get(`participant:${participantName}:sessionId`)
  }

  async setSessionIdToParticipant(
    participantName: string,
    sessionId: string,
  ): Promise<void> {
    await this.redis.set(`participant:${participantName}:sessionId`, sessionId)
  }

  async deleteParticipantNameInSession(participantName: string): Promise<void> {
    await this.redis.del(`participant:${participantName}:sessionId`)
  }

  // 타이머 카운트
  async getTimerCountBySessionId(sessionId: string): Promise<number | null> {
    const timerCount = await this.redis.get(`session:${sessionId}:timerCount`)
    return parseInt(timerCount, 10)
  }

  async incrTimerCountBySessionId(sessionId: string): Promise<void> {
    await this.redis.incr(`session:${sessionId}:timerCount`)
  }

  async decrTimerCountBySessionId(sessionId: string): Promise<void> {
    await this.redis.decr(`session:${sessionId}:timerCount`)
  }

  async deleteTimerCountBySessionId(sessionId: string): Promise<void> {
    await this.redis.del(`session:${sessionId}:timerCount`)
  }

  // 큐피드 플래그
  async getCupidFlagBySessionId(sessionId: string): Promise<boolean | null> {
    const flag = await this.redis.get(`session:${sessionId}:cupidFlag`)
    return flag === 'true'
  }

  async setCupidFlagBySessionId(sessionId: string): Promise<void> {
    await this.redis.set(`session:${sessionId}:cupidFlag`, 'true')
  }

  async deleteCupidFlagBySessionId(sessionId: string): Promise<void> {
    await this.redis.del(`session:${sessionId}:cupidFlag`)
  }

  // 최종선택 플래그
  async getLastCupidFlagBySessionId(
    sessionId: string,
  ): Promise<boolean | null> {
    const flag = await this.redis.get(`session:${sessionId}:lastCupidFlag`)
    return flag === 'true'
  }

  async setLastCupidFlagBySessionId(sessionId: string): Promise<void> {
    await this.redis.set(`session:${sessionId}:lastCupidFlag`, 'true')
  }

  async deleteLastCupidFlagBySessionId(sessionId: string): Promise<void> {
    await this.redis.del(`session:${sessionId}:lastCupidFlag`)
  }

  // 1:1대화 수락 플래그
  async getAcceptanceStatus(partnerName: string): Promise<boolean | null> {
    const status = await this.redis.get(
      `partner:${partnerName}:acceptanceStatus`,
    )
    return status === 'true'
  }

  async setAcceptanceStatus(myName: string): Promise<void> {
    await this.redis.set(`partner:${myName}:acceptanceStatus`, 'true')
  }

  async deleteAcceptanceStatus(socketId: string): Promise<void> {
    const participantName = await this.getParticipantNameBySocketId(socketId)
    if (participantName) {
      await this.redis.del(`partner:${participantName}:acceptanceStatus`)
    }
  }

  private sessions: Record<
    string,
    {
      session: Session
      participants: {
        name: string
        socketId: string
      }[]
    }
  > = {}

  private sessionTimers: Record<string, NodeJS.Timeout> = {}

  // 오픈비두 세션
  getSessions() {
    return this.sessions
  }

  async createSession(sessionId: string): Promise<void> {
    const session = await this.openvidu.createSession({
      customSessionId: sessionId,
    })
    this.sessions[sessionId] = { session, participants: [] }
  }

  async deleteSession(sessionId: string): Promise<void> {
    if (this.sessions[sessionId]) {
      delete this.sessions[sessionId]
    }
  }

  addParticipant(sessionId: string, participantName: string, socketId: string) {
    if (this.sessions[sessionId]) {
      this.sessions[sessionId].participants.push({
        name: participantName,
        socketId,
      })
    } else {
      console.error(`Session ${sessionId} does not exist`)
    }
  }

  removeParticipant(sessionId: string, myId: string) {
    if (this.sessions[sessionId]) {
      const participants = this.getParticipants(sessionId)
      this.sessions[sessionId].participants = participants.filter(
        p => p.name !== myId,
      )
      if (this.sessions[sessionId].participants.length === 0) {
        clearInterval(this.sessionTimers[sessionId])
        this.clearSessionData(sessionId)
      }
    } else {
      console.error(`Session ${sessionId} does not exist`)
    }
  }

  clearSessionData(sessionId: string) {
    console.log(`Clearing session data for ${sessionId}`)
    this.deleteChooseData(sessionId)
    delete this.sessions[sessionId]
    if (this.sessionTimers[sessionId]) {
      console.log('타이머 초기화 중')
      clearInterval(this.sessionTimers[sessionId])
      delete this.sessionTimers[sessionId]
    }
  }

  getParticipants(sessionId: string) {
    const sessions = this.sessions[sessionId]
    if (sessions) return this.sessions[sessionId].participants

    return []
  }

  async generateTokens(sessionId: string) {
    const session = this.sessions[sessionId]?.session
    if (!session) {
      console.error(`No session found for ${sessionId}`)
      return []
    }

    const tokenPromises = this.sessions[sessionId].participants.map(
      async ({ name }) => {
        const tokenOptions = {
          role: OpenViduRole.PUBLISHER,
          data: name,
        }
        try {
          console.log(
            `Generating token for session: ${sessionId}, participant: ${name}`,
          )
          const token = await session.generateToken(tokenOptions)
          console.log(`Token generated: ${token}`)
          return token
        } catch (error) {
          console.error(
            `Error generating token for session: ${sessionId}, participant: ${name}`,
            error,
          )
          throw error
        }
      },
    )

    try {
      const tokens = await Promise.all(tokenPromises)
      return this.sessions[sessionId].participants.map(
        (participant, index) => ({
          participant: participant.name,
          token: tokens[index],
        }),
      )
    } catch (error) {
      console.error('Error generating tokens:', error)
      return []
    }
  }

  async startVideoChatSession(sessionId: string) {
    try {
      const tokens = await this.generateTokens(sessionId)

      tokens.forEach(({ participant, token }, index) => {
        const participantSocketId =
          this.getParticipants(sessionId)[index].socketId
        this.server.to(participantSocketId).emit('startCall', {
          sessionId: sessionId,
          token: token,
          participantName: participant,
        })
      })
    } catch (error) {
      console.error('Error generating tokens: ', error)
    }
  }

  startSessionTimer(sessionId: string, server: Server) {
    const timers = [
      { time: 1 / 12, event: 'introduce' },
      { time: 1 / 3, event: 'keyword' },
      { time: 2 / 3, event: 'cupidTime' },
      { time: 94 / 60, event: 'cam' },
      { time: 104 / 60, event: 'drawingContest' },
      { time: 2.9, event: 'lastCupidTime' },
      { time: 3.1, event: 'finish' },
    ]

    // 세션 타이머 초기화 (필요한 경우)
    if (this.sessionTimers[sessionId]) {
      clearTimeout(this.sessionTimers[sessionId])
    }

    let elapsedTime = 0
    let currentTimerIndex = 0

    const timerId = setInterval(() => {
      elapsedTime += 1
      if (
        currentTimerIndex < timers.length &&
        elapsedTime === Math.floor(timers[currentTimerIndex].time * 60)
      ) {
        const { event } = timers[currentTimerIndex]
        let message: string | null = null
        let messageArray: string[] | undefined = undefined

        if (event === 'keyword') {
          const getRandomNumber = () => Math.floor(Math.random() * 20) + 1
          message = `${getRandomNumber()}`
          // message = '0'
        } else if (event === 'introduce') {
          const TeamArray = this.getParticipants(sessionId).map(
            user => user.name,
          )
          // const TeamArray = ['시아']

          messageArray = this.shuffleArray(TeamArray)
          // messageArray = TeamArray
        } else {
          message = `${event}`
        }

        this.notifySessionParticipants(
          sessionId,
          event,
          message,
          server,
          messageArray,
        )
        currentTimerIndex++ // 다음 타이머로 이동
      }

      if (currentTimerIndex >= timers.length) {
        clearInterval(timerId)
      }
    }, 1000)

    this.sessionTimers[sessionId] = timerId
  }

  notifySessionParticipants(
    sessionId: string,
    eventType: string,
    message: string,
    server: Server,
    messageArray?: string[],
  ) {
    const participants = this.getParticipants(sessionId)
    if (eventType == 'keyword') {
      const getRandomParticipant = participants[1].name
    //  const getRandomParticipant = '시아'

      participants.forEach(({ socketId }) => {
        server.to(socketId).emit(eventType, { message, getRandomParticipant })
      })
    } else if (eventType == 'introduce') {
      participants.forEach(({ socketId }) => {
        server.to(socketId).emit(eventType, messageArray)
      })
    } else if (eventType == 'drawingContest') {
      const keywordsIndex = Math.random() * 1234
      participants.forEach(({ socketId }) => {
        server.to(socketId).emit(eventType, { message, keywordsIndex })
      })
    } else {
      participants.forEach(({ socketId }) => {
        server.to(socketId).emit(eventType, { message })
      })
    }
  }

  // 1:1 선택 결과
  async getChooseData(sessionId: string): Promise<ChooseResult[]> {
    const chooseData = await this.redis.hgetall(`choose:${sessionId}`)
    const result: ChooseResult[] = []

    for (const [sender, receiver] of Object.entries(chooseData)) {
      result.push({ sender, receiver })
    }
    return result
  }

  async setChooseData(sessionId: string, sender: string, receiver: string) {
    await this.redis.hset(`choose:${sessionId}`, sender, receiver)
  }

  async deleteChooseData(sessionId: string) {
    await this.redis.del(`choose:${sessionId}`)
  }

  async findMatchingPairs(
    sessionId: string,
  ): Promise<{ pair: [string, string] }[]> {
    const chooseData = await this.getChooseData(sessionId)
    const matches: { pair: [string, string] }[] = []

    for (const { sender, receiver } of chooseData) {
      const isPair = chooseData.find(
        choice => choice.sender === receiver && choice.receiver === sender,
      )
      if (isPair) {
        matches.push({ pair: [sender, receiver] })
      }
    }

    return matches
  }

  // 그림대회 그림 관리
  async saveDrawing(
    sessionId: string,
    userName: string,
    drawing: string,
  ): Promise<void> {
    await this.redis.hset(`session:${sessionId}:drawings`, userName, drawing)
  }

  async getDrawings(sessionId: string): Promise<Record<string, string>> {
    return await this.redis.hgetall(`session:${sessionId}:drawings`)
  }

  async resetDrawings(sessionId: string): Promise<void> {
    await this.redis.del(`session:${sessionId}:drawings`)
  }

  // 그림대회 사진 관리
  async savePhoto(
    sessionId: string,
    userName: string,
    photo: string,
  ): Promise<void> {
    await this.redis.hset(`session:${sessionId}:photos`, userName, photo)
  }

  async getPhotos(sessionId: string): Promise<Record<string, string>> {
    return await this.redis.hgetall(`session:${sessionId}:photos`)
  }

  async resetPhotos(sessionId: string): Promise<void> {
    await this.redis.del(`session:${sessionId}:photos`)
  }

  // 그림대회 투표 관리
  async saveVote(
    sessionId: string,
    userName: string,
    votedUserName: string,
  ): Promise<void> {
    await this.redis.hset(`session:${sessionId}:votes`, userName, votedUserName)
  }

  async getVotes(sessionId: string): Promise<Record<string, string>> {
    return await this.redis.hgetall(`session:${sessionId}:votes`)
  }

  async deleteVotes(sessionId: string): Promise<void> {
    await this.redis.del(`session:${sessionId}:votes`)
  }

  async calculateWinner(
    sessionId: string,
  ): Promise<{ winner: string; losers: string[] }> {
    const voteCount: Record<string, number> = {}
    const votes = await this.getVotes(sessionId)
    for (const vote in votes) {
      const votedUser = votes[vote]
      if (!voteCount[votedUser]) voteCount[votedUser] = 0
      voteCount[votedUser]++
    }

    const winner = Object.keys(voteCount).reduce((a, b) =>
      voteCount[a] > voteCount[b] ? a : b,
    )
    const losers = Object.keys(votes).filter(user => user !== winner)

    await this.deleteVotes(sessionId)
    return { winner, losers }
  }
}
