import {
  WebSocketGateway,
  SubscribeMessage,
  OnGatewayInit,
  OnGatewayConnection,
  OnGatewayDisconnect,
  WebSocketServer,
} from '@nestjs/websockets'
import { Body, UseGuards } from '@nestjs/common'
import { Server, Socket } from 'socket.io'
import { OpenViduService } from './meeting.service'
// import { JwtAuthWsGuard } from '../guards/jwt-auth.ws.guard'

// @UseGuards(JwtAuthWsGuard)
@WebSocketGateway({
  namespace: 'meeting',
  cors: {
    origin: '*', // 모든 출처에서의 요청 허용
    methods: ['GET', 'POST'],
    allowedHeaders: ['Content-Type'],
    credentials: true,
  },
})
export class MeetingGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer() server: Server

  constructor(private readonly openviduService: OpenViduService) {}

  afterInit(server: Server) {
    console.log('WebSocket initialized')
  }

  handleConnection(client: Socket) {
    console.log('New client connected')
  }

  handleDisconnect(client: Socket) {
    const sessions = this.openviduService.getSessions()
    for (const sessionName in sessions) {
      if (sessions.hasOwnProperty(sessionName)) {
        this.openviduService.removeParticipant(sessionName, client)
      }
    }
  }

  // @SubscribeMessage('ready')
  // async handleReady(client: Socket) {
  //   try {
  //     const participantName = client['user'].participantName
  @SubscribeMessage('ready')
  async handleReady(client: Socket, payload: { participantName: string }) {
    try {
      const { participantName } = payload
      const sessionName =
        await this.openviduService.findOrCreateAvailableSession()
      if (sessionName) {
        console.log('Session successfully created or retrieved')
        await this.handleJoinQueue(sessionName, participantName, client)
      } else {
        console.error('Failed to create or retrieve session')
      }
    } catch (error) {
      console.log('Error handling join Queue request:', error)
    }
  }

  @SubscribeMessage('cancel')
  handleCancel(client: Socket) {
    const sessions = this.openviduService.getSessions()
    for (const sessionName in sessions) {
      if (sessions.hasOwnProperty(sessionName)) {
        this.openviduService.removeParticipant(sessionName, client)
      }
    }
  }

  async handleJoinQueue(
    sessionName: string,
    participantName: string,
    client: Socket,
  ) {
    try {
      this.openviduService.addParticipant(sessionName, participantName, client)
      const participants = this.openviduService.getParticipants(sessionName)
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
        const newSessionName = this.openviduService.generateSessionName()
        await this.openviduService.createSession(newSessionName)
        console.log(`New session prepared: ${newSessionName}`)
      }
    } catch (error) {
      console.error('Error joining queue:', error)
      // 세션 참가 실패 시 세션 삭제
      await this.openviduService.deleteSession(sessionName)
    }
  }

  async startVideoChatSession(sessionName: string) {
    try {
      const tokens = await this.openviduService.generateTokens(sessionName)
      const session = this.openviduService.getSession(sessionName)
      if (!session) {
        console.error(
          `No session found for ${sessionName} during startVideoChatSession`,
        )
        return
      }
      tokens.forEach(({ participant, token }, index) => {
        const participantSocket =
          this.openviduService.getParticipants(sessionName)[index].socket
        participantSocket.emit('startCall', {
          sessionId: session.sessionId,
          token: token,
          participantName: participant,
        })
      })
      await this.openviduService.resetParticipants(sessionName)
    } catch (error) {
      console.error('Error generating tokens: ', error)
    }
  }
}
