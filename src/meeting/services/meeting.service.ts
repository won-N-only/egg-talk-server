import { Injectable, Inject } from '@nestjs/common'
import { CACHE_MANAGER, Cache } from '@nestjs/cache-manager'
import { OpenViduRole } from 'openvidu-node-client'
import { Socket, Server } from 'socket.io'
import Redis from 'ioredis'
import { SessionService } from './session.service'
import { TimerService } from './timer.service'
import { DrawingContestService } from './drawingContest.service'

type ChooseResult = {
  sender: string
  receiver: string
}

@Injectable()
export class MeetingService {
  public server: Server
  private redis: Redis

  constructor(
    @Inject(CACHE_MANAGER) private cacheManager: Cache,
    private readonly sessionService: SessionService,
    private readonly timerService: TimerService,
    private readonly drawingPhotoService: DrawingContestService,
  ) {
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
    return this.sessionService.generateSessionId()
  }

  // 소켓 관리
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

  // 세션 관리
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

  // 큐피드 플래그
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

  // 최종선택 플래그
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

  // 1:1대화 수락 플래그
  async getAcceptanceStatus(partnerName: string): Promise<boolean> {
    return await this.cacheManager.get<boolean>(
      `partner:${partnerName}:acceptanceStatus`,
    )
  }

  async setAcceptanceStatus(myName: string): Promise<void> {
    await this.cacheManager.set(`partner:${myName}:acceptanceStatus`, true)
  }

  async deleteAcceptanceStatus(socketId: string): Promise<void> {
    const participantName = await this.getParticipantNameBySocketId(socketId)
    if (participantName) {
      await this.cacheManager.del(`partner:${participantName}:acceptanceStatus`)
    }
  }

  addParticipant(sessionId: string, participantName: string, socket: Socket) {
    this.sessionService.addParticipant(sessionId, participantName, socket)
  }

  removeParticipant(sessionId: string, socket: Socket, myId: string) {
    this.sessionService.removeParticipant(sessionId, socket, myId)
    if (this.sessionService.getParticipants(sessionId).length === 0) {
      this.timerService.clearSessionTimer(sessionId)
      this.clearSessionData(sessionId)
    }
  }

  clearSessionData(sessionId: string) {
    console.log(`Clearing session data for ${sessionId}`)
    this.deleteChooseData(sessionId)
    this.sessionService.clearSessionData(sessionId)
  }

  getParticipants(sessionId: string) {
    return this.sessionService.getParticipants(sessionId)
  }

  async generateTokens(sessionId: string) {
    const session = this.sessionService.getSession(sessionId)
    if (!session) {
      console.error(`No session found for ${sessionId}`)
      return []
    }

    const tokenPromises = this.getParticipants(sessionId).map(
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
      return this.getParticipants(sessionId).map((participant, index) => ({
        participant: participant.name,
        token: tokens[index],
      }))
    } catch (error) {
      console.error('Error generating tokens:', error)
      return []
    }
  }

  async resetParticipants(sessionId: string) {
    if (this.sessionService.getSession(sessionId)) {
      const newSessionId = this.generateSessionId()
      const newSession = await this.sessionService.createSession(newSessionId)
      this.sessionService.clearSessionData(newSessionId)
      console.log(
        `Session ${sessionId} reset and new session ${newSessionId} created with ID ${newSession.sessionId}`,
      )
    } else {
      console.error(`Session ${sessionId} does not exist`)
    }
  }

  async startVideoChatSession(sessionId: string) {
    try {
      const tokens = await this.generateTokens(sessionId)
      const session = this.sessionService.getSession(sessionId)

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
    this.timerService.startSessionTimer(sessionId, server)
  }

  notifySessionParticipants(
    sessionId: string,
    eventType: string,
    message: string,
    server: Server,
    messageArray?: string[],
  ) {
    this.timerService.notifySessionParticipants(
      sessionId,
      eventType,
      message,
      server,
      messageArray,
    )
  }

  async setChooseData(sessionId: string, sender: string, receiver: string) {
    await this.redis.hset(`choose:${sessionId}`, sender, receiver)
  }

  async deleteChooseData(sessionId: string) {
    await this.redis.del(`choose:${sessionId}`)
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

  async saveDrawing(
    sessionId: string,
    userName: string,
    drawing: string,
  ): Promise<void> {
    await this.drawingPhotoService.saveDrawing(sessionId, userName, drawing)
  }

  async getDrawings(sessionId: string): Promise<Record<string, string>> {
    return await this.drawingPhotoService.getDrawings(sessionId)
  }

  async resetDrawings(sessionId: string): Promise<void> {
    await this.drawingPhotoService.resetDrawings(sessionId)
  }

  async savePhoto(
    sessionId: string,
    userName: string,
    photo: string,
  ): Promise<void> {
    await this.drawingPhotoService.savePhoto(sessionId, userName, photo)
  }

  async getPhotos(sessionId: string): Promise<Record<string, string>> {
    return await this.drawingPhotoService.getPhotos(sessionId)
  }

  async resetPhotos(sessionId: string): Promise<void> {
    await this.drawingPhotoService.resetPhotos(sessionId)
  }

  async saveVote(
    sessionId: string,
    userName: string,
    votedUserName: string,
  ): Promise<void> {
    await this.drawingPhotoService.saveVote(sessionId, userName, votedUserName)
  }

  async getVotes(sessionId: string): Promise<Record<string, string>> {
    return await this.drawingPhotoService.getVotes(sessionId)
  }

  async deleteVotes(sessionId: string): Promise<void> {
    await this.drawingPhotoService.deleteVotes(sessionId)
  }

  async calculateWinner(
    sessionId: string,
  ): Promise<{ winner: string; losers: string[] }> {
    return await this.drawingPhotoService.calculateWinner(sessionId)
  }
}
