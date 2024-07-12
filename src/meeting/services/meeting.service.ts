import { Injectable, Inject } from '@nestjs/common'
import { CACHE_MANAGER, Cache } from '@nestjs/cache-manager'
import { OpenVidu, OpenViduRole, Session } from 'openvidu-node-client'
import { Socket, Server } from 'socket.io'
import { v4 as uuidv4 } from 'uuid'
import Redis from 'ioredis'

@Injectable()
export class MeetingService {
  private openvidu: OpenVidu
  public server: Server
  private sessions: Record<string, { session: Session; participants: any[] }> =
    {}
  private sessionTimers: Record<string, NodeJS.Timeout> = {}
  private redis: Redis

  constructor(@Inject(CACHE_MANAGER) private cacheManager: Cache) {
    const OPENVIDU_URL = process.env.OPENVIDU_URL
    const OPENVIDU_SECRET = process.env.OPENVIDU_SECRET
    this.openvidu = new OpenVidu(OPENVIDU_URL, OPENVIDU_SECRET)

    this.redis = new Redis({
      host: process.env.REDIS_HOST,
      port: parseInt(process.env.REDIS_PORT, 10),
    })
  }

  private connectedSockets = new Map<string, Socket>() // socketId: Socket

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

  async getParticipantNameBySocketId(socketId: string): Promise<string> {
    return await this.cacheManager.get<string>(
      `socket:${socketId}:participantName`,
    )
  }

  async getSocketByUserId(nickname: string): Promise<Socket> {
    const socketId = await this.cacheManager.get<string>(
      `meeting:user:${nickname}`,
    )
    if (socketId) return this.connectedSockets.get(socketId)

    return null
  }

  async setConnectedSocket(
    participantName: string,
    client: Socket,
  ): Promise<void> {
    this.connectedSockets.set(client.id, client)
    await this.cacheManager.set(
      `socket:${client.id}:participantName`,
      participantName,
    )
    await this.cacheManager.set(
      `participant:${participantName}:socketId`,
      client.id,
    )
  }

  async deleteConnectedSocket(socketId: string): Promise<void> {
    const participantName = await this.getParticipantNameBySocketId(socketId)
    if (participantName) {
      await this.cacheManager.del(`participant:${participantName}:socketId`)
    }
    await this.cacheManager.del(`socket:${socketId}:participantName`)
    this.connectedSockets.delete(socketId)
  }

  async getSessionIdByParticipantName(
    participantName: string,
  ): Promise<string> {
    return await this.cacheManager.get<string>(
      `participant:${participantName}:sessionId`,
    )
  }

  async setParticipantNameToSession(
    participantName: string,
    sessionId: string,
  ): Promise<void> {
    await this.cacheManager.set(
      `participant:${participantName}:sessionId`,
      sessionId,
    )
  }

  async deleteParticipantNameInSession(participantName: string): Promise<void> {
    await this.cacheManager.del(`participant:${participantName}:sessionId`)
  }

  async getTimerFlagBySessionId(sessionId: string): Promise<boolean> {
    return await this.cacheManager.get<boolean>(
      `session:${sessionId}:timerFlag`,
    )
  }

  async setTimerFlagBySessionId(sessionId: string): Promise<void> {
    await this.cacheManager.set(`session:${sessionId}:timerFlag`, true)
  }

  async deleteTimerFlagBySessionId(sessionId: string): Promise<void> {
    await this.cacheManager.del(`session:${sessionId}:timerFlag`)
  }

  async getCupidFlagBySessionId(sessionId: string): Promise<boolean> {
    return await this.cacheManager.get<boolean>(
      `session:${sessionId}:cupidFlag`,
    )
  }

  async setCupidFlagBySessionId(sessionId: string): Promise<void> {
    await this.cacheManager.set(`session:${sessionId}:cupidFlag`, true)
  }

  async deleteCupidFlagBySessionId(sessionId: string): Promise<void> {
    await this.cacheManager.del(`session:${sessionId}:cupidFlag`)
  }

  async getLastCupidFlagBySessionId(sessionId: string): Promise<boolean> {
    return await this.cacheManager.get<boolean>(
      `session:${sessionId}:lastCupidFlag`,
    )
  }

  async setLastCupidFlagBySessionId(sessionId: string): Promise<void> {
    await this.cacheManager.set(`session:${sessionId}:lastCupidFlag`, true)
  }

  async deleteLastCupidFlagBySessionId(sessionId: string): Promise<void> {
    await this.cacheManager.del(`session:${sessionId}:lastCupidFlag`)
  }

  async getAcceptanceStatus(partnerName: string): Promise<boolean> {
    return await this.cacheManager.get<boolean>(
      `partner:${partnerName}:acceptanceStatus`,
    )
  }

  async setAcceptanceStatus(partnerName: string): Promise<void> {
    await this.cacheManager.set(`partner:${partnerName}:acceptanceStatus`, true)
  }

  async deleteAcceptanceStatus(socketId: string): Promise<void> {
    const participantName = await this.getParticipantNameBySocketId(socketId)
    if (participantName)
      await this.cacheManager.del(`partner:${participantName}:acceptanceStatus`)
  }

  async createSession(sessionId: string): Promise<Session> {
    if (!this.sessions[sessionId]) {
      try {
        const session = await this.openvidu.createSession({
          customSessionId: sessionId,
        })
        this.sessions[sessionId] = { session, participants: [] }
        console.log(`Session created: ${sessionId}, ID: ${session.sessionId}`)
        return session
      } catch (error) {
        console.error('Error creating session:', error)
        throw error
      }
    } else {
      console.log(`Session already exists: ${sessionId}`)
      return this.sessions[sessionId].session
    }
  }

  async deleteSession(sessionId: string): Promise<void> {
    if (this.sessions[sessionId]) {
      delete this.sessions[sessionId]
      console.log(`Session deleted: ${sessionId}`)
    } else {
      console.error(`Session ${sessionId} does not exist`)
    }
  }

  addParticipant(sessionId: string, participantName: string, socket: any) {
    // gender별로 나눠야할 것 같음
    if (this.sessions[sessionId]) {
      this.sessions[sessionId].participants.push({
        name: participantName,
        socket,
      })
      console.log(
        '참여자가 추가되었습니다. 세션이름: ',
        sessionId,
        '참여자 이름 : ',
        participantName,
      )
    } else {
      console.error(`Session ${sessionId} does not exist`)
    }
  }

  removeParticipant(sessionId: string, socket: any, myid: string) {
    if (this.sessions[sessionId]) {
      // console.log(this.sessions[sessionId].participants.map(p => p.name))
      const participants = this.getParticipants(sessionId)
      this.sessions[sessionId].participants = participants.filter(
        p => p.name !== myid,
      )
      console.log(
        "/meetingService' 세션 참가자 수: ",
        this.sessions[sessionId].participants.length,
      )
      if (this.sessions[sessionId].participants.length === 0) {
        console.log(
          "'/meetingService' 세션 참가자가 없습니다",
          this.sessions[sessionId].participants.length,
          'sessionId 는',
          sessionId,
        )
        clearInterval(this.sessionTimers[sessionId])
        this.clearSessionData(sessionId)
      }
    } else {
      console.error(`Session ${sessionId} does not exist`)
    }
  }

  clearSessionData(sessionId: string) {
    console.log(`Clearing session data for ${sessionId}`)
    delete this.chooseData[sessionId]
    delete this.sessions[sessionId]
    if (this.sessionTimers[sessionId]) {
      console.log('타이머 초기화 중')
      clearInterval(this.sessionTimers[sessionId])
      delete this.sessionTimers[sessionId]
    }
  }

  getParticipants(sessionId: string) {
    const sessions = this.sessions[sessionId]
    if (sessions) {
      return this.sessions[sessionId].participants
    }
    return []
    // return this.sessions[sessionId]
    //   ? this.sessions[sessionId].participants
    //   : []
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

  async resetParticipants(sessionId: string) {
    if (this.sessions[sessionId]) {
      const newSessionId = this.generateSessionId()
      const newSession = await this.createSession(newSessionId)
      this.sessions[newSessionId] = { session: newSession, participants: [] }
      console.log(
        `Session ${sessionId} reset and new session ${newSessionId} created with ID ${newSession.sessionId}`,
      )
    } else {
      console.error(`Session ${sessionId} does not exist`)
    }
  }

  getSession(sessionId: string) {
    return this.sessions[sessionId]?.session
  }

  async startVideoChatSession(sessionId: string) {
    try {
      const tokens = await this.generateTokens(sessionId)
      const session = this.getSession(sessionId)
      const participants = this.getParticipants(sessionId)

      if (!session) {
        console.error(
          `No session found for ${sessionId} during startVideoChatSession`,
        )
        return
      }
      tokens.forEach(({ participant, token }, index) => {
        const participantSocket = this.getParticipants(sessionId)[index].socket
        participantSocket.emit('startCall', {
          sessionId: session.sessionId,
          token: token,
          participantName: participant,
        })
      })

      await this.resetParticipants(sessionId)
    } catch (error) {
      console.error('Error generating tokens: ', error)
    }
  }
  startSessionTimer(sessionId: string, server: Server) {
    const timers = [
      { time: 0.5, event: 'introduce' },
      { time: 2.5, event: 'keyword' },
      { time: 4, event: 'cupidTime' },
      { time: 6, event: 'cam' },
      { time: 6.5, event: 'drawingContest' },
      { time: 8.5, event: 'lastCupidTime' },
      { time: 9, event: 'finish' },
    ]

    // 세션 타이머 초기화 (필요한 경우)
    if (this.sessionTimers[sessionId]) {
      clearTimeout(this.sessionTimers[sessionId])
    }

    let elapsedTime = 0 // 경과 시간
    let currentTimerIndex = 0 // 현재 타이머 인덱스

    const timerId = setInterval(() => {
      elapsedTime += 1 // 1초씩 증가

      // 현재 타이머 인덱스가 유효하고, 경과 시간이 현재 타이머의 시간과 같으면 이벤트 발생
      if (
        currentTimerIndex < timers.length &&
        elapsedTime === timers[currentTimerIndex].time * 60
      ) {
        const { event } = timers[currentTimerIndex]
        let message: string | null
        let messageArray: string[] | undefined

        if (event === 'keyword') {
          const getRandomNumber = () => Math.floor(Math.random() * 20) + 1
          message = `${getRandomNumber()}`
        } else if (event === 'introduce') {
          const TeamArray = this.getParticipants(sessionId).map(
            user => user.name,
          )
          messageArray = this.shuffleArray(TeamArray)
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

      // 모든 타이머가 완료되면 setInterval 종료
      if (currentTimerIndex >= timers.length) {
        clearInterval(timerId)
      }
    }, 1000) // 1초마다 실행

    this.sessionTimers[sessionId] = timerId // 타이머 ID 저장
  }

  notifySessionParticipants(
    sessionId: string,
    eventType: string,
    message: string,
    server: Server,
    messageArray?: string[],
  ) {
    const participants = this.getParticipants(sessionId)
    // console.log('현재 참여자 목록입니다 => ', participants)
    if (eventType == 'keyword') {
      const getRandomParticipant = participants[1].name
      participants.forEach(({ socket }) => {
        server.to(socket.id).emit(eventType, { message, getRandomParticipant })
      })
    } else if (eventType == 'introduce') {
      participants.forEach(({ socket }) => {
        server.to(socket.id).emit(eventType, messageArray)
      })
    } else if (eventType == 'drawingContest') {
      const keywordsIndex = Math.random() * 1234
      participants.forEach(({ socket }) => {
        server.to(socket.id).emit(eventType, { message, keywordsIndex })
      })
    } else {
      participants.forEach(({ socket }) => {
        server.to(socket.id).emit(eventType, { message })
      })
    }
  }

  getSessions() {
    return this.sessions
  }

  async setChooseData(sessionId: string, sender: string, receiver: string) {
    await this.redis.hset(`choose:${sessionId}`, sender, receiver)
  }

  async deleteChooseData(sessionId: string) {
    await this.redis.del(`choose:${sessionId}`)
  }

  async getChooseData(sessionId: string) {
    return await this.redis.hgetall(`choose:${sessionId}`)
  }

  async findMatchingPairs(sessionId: string) {
    const chooseData = await this.getChooseData(sessionId)
    const matches = []
    for (const [sender, receiver] of Object.entries(chooseData)) {
      const isPair = Object.entries(chooseData).find(
        ([otherSender, otherReceiver]) =>
          otherSender === receiver && otherReceiver === sender,
      )
      if (isPair) {
        matches.push({ pair: [sender, receiver] })
      }
    }

    return matches
  }

  async saveDrawing(
    sessionId: string,
    userName: string,
    drawing: string,
  ): Promise<void> {
    const drawings = await this.cacheManager.get<Record<string, string>>(
      `session:${sessionId}:drawings`,
    )
    drawings[userName] = drawing
    await this.cacheManager.set(`session:${sessionId}:drawings`, drawings)
  }

  async getDrawings(sessionId: string): Promise<Record<string, string>> {
    return await this.cacheManager.get<Record<string, string>>(
      `session:${sessionId}:drawings`,
    )
  }

  async resetDrawings(sessionId: string): Promise<void> {
    await this.cacheManager.del(`session:${sessionId}:drawings`)
  }

  async savePhoto(
    sessionId: string,
    userName: string,
    photo: string,
  ): Promise<void> {
    const photos = await this.cacheManager.get<Record<string, string>>(
      `session:${sessionId}:photos`,
    )
    photos[userName] = photo
    await this.cacheManager.set(`session:${sessionId}:photos`, photos)
  }

  async getPhotos(sessionId: string): Promise<Record<string, string>> {
    return await this.cacheManager.get<Record<string, string>>(
      `session:${sessionId}:photos`,
    )
  }

  async resetPhotos(sessionId: string): Promise<void> {
    await this.cacheManager.del(`session:${sessionId}:photos`)
  }

  async saveVote(
    sessionId: string,
    userName: string,
    votedUserName: string,
  ): Promise<void> {
    const votes = await this.cacheManager.get<Record<string, string>>(
      `session:${sessionId}:votes`,
    )
    votes[userName] = votedUserName
    await this.cacheManager.set(`session:${sessionId}:votes`, votes)
  }

  async getVotes(sessionId: string): Promise<Record<string, string>> {
    return await this.cacheManager.get<Record<string, string>>(
      `session:${sessionId}:votes`,
    )
  }

  async deleteVotes(sessionId: string): Promise<void> {
    await this.cacheManager.del(`session:${sessionId}:votes`)
  }

  calculateWinner(sessionId: string): { winner: string; losers: string[] } {
    /**저장했던 그림 삭제 */
    const voteCount: Record<string, number> = {}

    const votes = this.getVotes(sessionId)
    for (const vote in votes) {
      const votedUser = votes[vote]
      if (!voteCount[votedUser]) voteCount[votedUser] = 0
      voteCount[votedUser]++
    }

    const winner = Object.keys(voteCount).reduce((a, b) =>
      voteCount[a] > voteCount[b] ? a : b,
    )

    const losers = Object.keys(votes).filter(user => user !== winner)

    this.deleteVotes(sessionId)
    return { winner, losers }
  }
}
