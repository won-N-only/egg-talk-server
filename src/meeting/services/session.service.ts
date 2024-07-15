import { Inject, Injectable } from '@nestjs/common'
import { Redis } from 'ioredis'
import { OpenVidu, Session } from 'openvidu-node-client'
import { v4 as uuidv4 } from 'uuid'
import { Server } from 'socket.io'

type sessionData = {
  tokens: string[]
  openviduUrl: string
}

@Injectable()
export class SessionService {
  /**url 받고 openVidu 객체 만들어서 세션발급 토큰발급 하는 함수 만들기 */
  private openVidu: OpenVidu
  private redis: Redis
  private server: Server
  private sessions: Record<
    string,
    { session: Session; participants: { name: string; socketId: string }[] }
  > = {}

  constructor(@Inject('REDIS') redis: Redis) {
    this.redis = redis
    const OPENVIDU_URL = process.env.OPENVIDU_URL
    const OPENVIDU_SECRET = process.env.OPENVIDU_SECRET
    this.openVidu = new OpenVidu(OPENVIDU_URL, OPENVIDU_SECRET)
  }

  async startVideoChatSession(sessionId: string) {
    const sessionDataString = await this.redis.get(`sessionId:${sessionId}`) //url뿐
    const sessionData: sessionData = JSON.parse(sessionDataString)
    const tokens =
      sessionData.tokens /**server에서 gen.tokens 하기, 세션 만들기 */
    const openviduUrl = sessionData.openviduUrl
    const participants = this.sessions[sessionId].participants
    participants.forEach((participant, index) => {
      this.sendTokenToParticipant(
        sessionId,
        tokens[index],
        participant.name,
        participant.socketId,
        openviduUrl,
      )
    })
  }

  private async sendTokenToParticipant(
    sessionId: string,
    token: string,
    participantName: string,
    participantSocketId: string,
    openviduUrl: string,
  ) {
    this.server.to(participantSocketId).emit('startCall', {
      sessionId,
      token,
      participantName,
      openviduUrl,
    })
  }

  generateSessionId() {
    return uuidv4()
  }

  async createSession(sessionId: string): Promise<Session> {
    if (!this.sessions[sessionId]) {
      const session = await this.openVidu.createSession({
        customSessionId: sessionId,
      })
      this.sessions[sessionId] = { session, participants: [] }
      return session
    } else {
      return this.sessions[sessionId].session
    }
  }

  async deleteSession(sessionId: string): Promise<void> {
    if (this.sessions[sessionId]) {
      delete this.sessions[sessionId]
    }
  }

  getSession(sessionId: string) {
    return this.sessions[sessionId]?.session
  }

  getSessions() {
    return this.sessions
  }

  addParticipant(sessionId: string, participantName: string, socketId: string) {
    if (this.sessions[sessionId]) {
      this.sessions[sessionId].participants.push({
        name: participantName,
        socketId: socketId,
      })
    } else {
      console.error(`Session ${sessionId} does not exist`)
    }
  }

  removeParticipant(sessionId: string, myId: string) {
    if (this.sessions[sessionId]) {
      this.sessions[sessionId].participants = this.sessions[
        sessionId
      ].participants.filter(p => p.name !== myId)
    } else {
      console.error(`Session ${sessionId} does not exist`)
    }
  }

  getParticipants(sessionId: string) {
    return this.sessions[sessionId]?.participants || []
  }
}
