import { Injectable } from '@nestjs/common'
import { OpenVidu, Session } from 'openvidu-node-client'
import { v4 as uuidv4 } from 'uuid'

@Injectable()
export class SessionService {
  private openVidu: OpenVidu
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

  constructor() {
    const OPENVIDU_URL = process.env.OPENVIDU_URL
    const OPENVIDU_SECRET = process.env.OPENVIDU_SECRET
    this.openVidu = new OpenVidu(OPENVIDU_URL, OPENVIDU_SECRET)
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
