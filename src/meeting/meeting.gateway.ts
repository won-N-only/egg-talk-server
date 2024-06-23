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

  // jwt사용시를 위한 코드
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
        await this.openviduService.handleJoinQueue(
          sessionName,
          participantName,
          client,
        )
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
}
