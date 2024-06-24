import { Injectable } from '@nestjs/common'
import { OpenVidu, OpenViduRole, Session } from 'openvidu-node-client'
import { Socket, Server } from 'socket.io'

@Injectable()
export class OpenViduService {
  private openvidu: OpenVidu
  private sessions: Record<string, { session: Session; participants: any[] }> =
    {}
  private sessionTimers: Record<string, NodeJS.Timeout> = {}
  public server: Server

  constructor() {
    const OPENVIDU_URL = process.env.OPENVIDU_URL
    const OPENVIDU_SECRET = process.env.OPENVIDU_SECRET
    this.openvidu = new OpenVidu(OPENVIDU_URL, OPENVIDU_SECRET)
  }

  generateSessionName() {
    return `session-${Date.now()}`
  }

  async createSession(sessionName: string): Promise<Session> {
    if (!this.sessions[sessionName]) {
      try {
        const session = await this.openvidu.createSession()
        this.sessions[sessionName] = { session, participants: [] }
        console.log(`Session created: ${sessionName}, ID: ${session.sessionId}`)
        return session
      } catch (error) {
        console.error('Error creating session:', error)
        throw error
      }
    } else {
      console.log(`Session already exists: ${sessionName}`)
      return this.sessions[sessionName].session
    }
  }

  async deleteSession(sessionName: string): Promise<void> {
    if (this.sessions[sessionName]) {
      delete this.sessions[sessionName]
      console.log(`Session deleted: ${sessionName}`)
    } else {
      console.error(`Session ${sessionName} does not exist`)
    }
  }

  addParticipant(sessionName: string, participantName: string, socket: any) {
    if (this.sessions[sessionName]) {
      this.sessions[sessionName].participants.push({
        name: participantName,
        socket,
      })
    } else {
      console.error(`Session ${sessionName} does not exist`)
    }
  }

  removeParticipant(sessionName: string, socket: any) {
    if (this.sessions[sessionName]) {
      this.sessions[sessionName].participants = this.sessions[
        sessionName
      ].participants.filter(p => p.socket !== socket)
    } else {
      console.error(`Session ${sessionName} does not exist`)
    }
  }

  getParticipants(sessionName: string) {
    return this.sessions[sessionName]
      ? this.sessions[sessionName].participants
      : []
  }

  async generateTokens(sessionName: string) {
    const session = this.sessions[sessionName]?.session
    if (!session) {
      console.error(`No session found for ${sessionName}`)
      return []
    }

    const tokenPromises = this.sessions[sessionName].participants.map(
      async ({ name }) => {
        const tokenOptions = {
          role: OpenViduRole.PUBLISHER,
          data: name,
        }
        try {
          console.log(
            `Generating token for session: ${sessionName}, participant: ${name}`,
          )
          const token = await session.generateToken(tokenOptions)
          console.log(`Token generated: ${token}`)
          return token
        } catch (error) {
          console.error(
            `Error generating token for session: ${sessionName}, participant: ${name}`,
            error,
          )
          throw error
        }
      },
    )

    try {
      const tokens = await Promise.all(tokenPromises)
      return this.sessions[sessionName].participants.map(
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

  async resetParticipants(sessionName: string) {
    if (this.sessions[sessionName]) {
      const newSessionName = this.generateSessionName()
      const newSession = await this.createSession(newSessionName)
      this.sessions[newSessionName] = { session: newSession, participants: [] }
      console.log(
        `Session ${sessionName} reset and new session ${newSessionName} created with ID ${newSession.sessionId}`,
      )
    } else {
      console.error(`Session ${sessionName} does not exist`)
    }
  }

  getSession(sessionName: string) {
    return this.sessions[sessionName]?.session
  }

  async findOrCreateAvailableSession(): Promise<string> {
    console.log('Finding or creating available session')

    for (const sessionName in this.sessions) {
      if (this.sessions.hasOwnProperty(sessionName)) {
        const participants = this.sessions[sessionName].participants

        if (participants.length < 6) {
          console.log(`Returning existing session: ${sessionName}`)
          return sessionName
        }
      }
    }

    const newSessionName = this.generateSessionName()
    await this.createSession(newSessionName)
    console.log(`Creating and returning new session: ${newSessionName}`)
    return newSessionName
  }

  async handleJoinQueue(
    sessionName: string,
    participantName: string,
    client: Socket,
  ) {
    try {
      this.addParticipant(sessionName, participantName, client)
      const participants = this.getParticipants(sessionName)
      console.log(
        'Current waiting participants: ',
        participants.map(p => p.name),
      )
      console.log(
        'Current number of waiting participants: ',
        participants.length,
      )

      if (participants.length === 6) {
        await this.startVideoChatSession(sessionName)
        // 새로운 세션을 생성하고 반환
        const newSessionName = this.generateSessionName()
        await this.createSession(newSessionName)
        console.log(`New session prepared: ${newSessionName}`)
      }
    } catch (error) {
      console.error('Error joining queue:', error)
      // 세션 참가 실패 시 세션 삭제
      await this.deleteSession(sessionName)
    }
  }

  async startVideoChatSession(sessionName: string) {
    try {
      const tokens = await this.generateTokens(sessionName)
      const session = this.getSession(sessionName)
      if (!session) {
        console.error(
          `No session found for ${sessionName} during startVideoChatSession`,
        )
        return
      }
      tokens.forEach(({ participant, token }, index) => {
        const participantSocket =
          this.getParticipants(sessionName)[index].socket
        participantSocket.emit('startCall', {
          sessionId: session.sessionId,
          token: token,
          participantName: participant,
        })
      })
      this.startSessionTimer(sessionName, this.server)
      await this.resetParticipants(sessionName)
    } catch (error) {
      console.error('Error generating tokens: ', error)
    }
  }

  startSessionTimer(sessionName: string, server: Server) {
    const timer = [1, 2, 3]
    if (this.sessionTimers[sessionName]) {
      clearTimeout(this.sessionTimers[sessionName])
    }
    const getRandomNumber = () => Math.floor(Math.random() * 20) + 1

    timer.forEach(time => {
      setTimeout(
        () => {
          const number = getRandomNumber()
          this.notifySessionParticipants(sessionName, `${number}`, server)
        },
        time * 60 * 1000,
      )
    })
  }

  notifySessionParticipants(
    sessionName: string,
    message: string,
    server: Server,
  ) {
    const participant = this.getParticipants(sessionName)
    participant.forEach(({ socket }) => {
      server.to(socket.id).emit('notification', { message })
    })
  }
  getSessions() {
    return this.sessions
  }
}
