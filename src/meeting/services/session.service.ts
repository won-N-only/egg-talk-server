import { forwardRef, Inject, Injectable } from '@nestjs/common'
import { OpenVidu, Session } from 'openvidu-node-client'
import { v4 as uuidv4 } from 'uuid'
import { Server } from 'socket.io'
import { MeetingService } from './meeting.service'
import { Redis } from 'ioredis'

@Injectable()
export class SessionService {
  private server: Server
  private sessions: Record<
    string,
    { session: Session; participants: { name: string; socketId: string }[] }
  > = {}
  private openViduInstances: Record<string, OpenVidu> = {}

  constructor(
    @Inject(forwardRef(() => MeetingService))
    private readonly meetingService: MeetingService,
    @Inject('REDIS') private readonly redis: Redis,
  ) {}

  async startVideoChatSession(sessionId: string, openViduUrl: string) {
    try {
      const openVidu = await this.getOpenViduInstance(openViduUrl)
      if (!openVidu) console.log('openVidu server broken')
      await this.createSession(sessionId, openVidu)
      const tokens = await this.meetingService.generateTokens(sessionId)
      const participants = this.sessions[sessionId].participants

      participants.forEach((participant, index) => {
        const token = tokens[index]
        this.sendTokenToParticipant(
          sessionId,
          token.token,
          participant.name,
          participant.socketId,
        )
      })
    } catch (e) {
      console.error('Error startVideoChatSession:', e)
    }
  }

  private async sendTokenToParticipant(
    sessionId: string,
    token: string,
    participantName: string,
    participantSocketId: string,
  ) {
    this.meetingService.server.to(participantSocketId).emit('startCall', {
      sessionId,
      token,
      participantName,
    })
  }

  async getOpenViduInstance(openviduUrl: string): Promise<OpenVidu> {
    if (!this.openViduInstances[openviduUrl]) {
      this.openViduInstances[openviduUrl] =
        await this.createOpenViduInstance(openviduUrl)
    }
    return this.openViduInstances[openviduUrl]
  }

  async createOpenViduInstance(openviduUrl: string) {
    const OPENVIDU_SECRET = process.env.OPENVIDU_SECRET
    return new OpenVidu(openviduUrl, OPENVIDU_SECRET)
  }

  async getOpenViduUrlBySessionId(sessionId: string) {
    return await this.redis.get(`sessionId:${sessionId}:openViduUrl`)
  }

  generateSessionId() {
    return uuidv4()
  }

  async findOrCreateNewSession(openVidu: OpenVidu): Promise<string> {
    const newSessionId = this.generateSessionId()
    await this.createSession(newSessionId, openVidu)
    console.log(`Creating and returning new session: ${newSessionId}`)
    return newSessionId
  }

  async initSession(sessionId: string) {
    this.sessions[sessionId] = { session: null, participants: [] }
  }

  async createSession(sessionId: string, openVidu: OpenVidu): Promise<Session> {
    const session = await openVidu.createSession({
      customSessionId: sessionId,
    })
    console.log('세션을 만드는 중입니다.', session.sessionId)
    this.sessions[sessionId].session = session
    return session
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
