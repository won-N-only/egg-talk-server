import {
  WebSocketGateway,
  SubscribeMessage,
  OnGatewayInit,
  OnGatewayConnection,
  OnGatewayDisconnect,
  WebSocketServer,
  ConnectedSocket,
} from '@nestjs/websockets'
import { Body, Req, UseGuards } from '@nestjs/common'
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
  private roomid: Map<string, string> = new Map()
  constructor(private readonly openviduService: OpenViduService) {}
  private connectedUsers: { [nickname: string]: string } = {} // nickname: socketId 형태로 변경
  private connectedSockets: { [socketId: string]: string } = {} // socketId: nickname 형태로 변경
  afterInit(server: Server) {
    this.openviduService.server = server
    console.log('WebSocket initialized')
  }

  handleConnection(client: Socket) {}

  handleDisconnect(client: Socket) {
    const sessions = this.openviduService.getSessions()
    const participantName = this.connectedSockets[client.id]
    for (const sessionName in sessions) {
      if (sessions.hasOwnProperty(sessionName)) {
        this.openviduService.removeParticipant(
          sessionName,
          client,
          participantName,
        )
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
      // const nickname = client['user'].nickname
      // const socketId = client.id
      // this.connectedSockets[socketId] = nickname
      // this.connectedUsers[nickname] = socketId
      const sessionName =
        await this.openviduService.findOrCreateAvailableSession()
      if (sessionName) {
        console.log('Session successfully created or retrieved')
        await this.openviduService.handleJoinQueue(
          sessionName,
          participantName,
          client,
        )
        this.roomid.set(participantName, sessionName)
      } else {
        console.error('Failed to create or retrieve session')
      }
    } catch (error) {
      console.log('Error handling join Queue request:', error)
    }
  }

  @SubscribeMessage('cancel')
  handleCancel(client: Socket, payload: { participantName: string }) {
    const sessions = this.openviduService.getSessions()
    const { participantName } = payload

    for (const sessionName in sessions) {
      if (sessions.hasOwnProperty(sessionName)) {
        this.openviduService.removeParticipant(
          sessionName,
          client,
          participantName,
        )
      }
    }
  }

  @SubscribeMessage('choose')
  handleChoose(client: Socket, payload: { sender: string; receiver: string }) {
    const sessionName = this.roomid.get(payload.sender)
    if (sessionName) {
      this.openviduService.storeChoose(
        sessionName,
        payload.sender,
        payload.receiver,
      )
      const chooseData = this.openviduService.getChooseData(sessionName)
      if (chooseData.length === 6) {
        const participants = this.openviduService.getParticipants(sessionName)
        const matches = this.openviduService.findMatchingPairs(sessionName)

        const matchedPairs = matches.map(match => ({
          pair: match.pair,
          others: matches.filter(p => p !== match),
        }))

        participants.forEach(({ socket, name }) => {
          // 매칭된 사람이 있는지 체크
          const matchedPair = matches.find(match => match.pair.includes(name))
          if (matchedPair) {
            const partner = matchedPair.pair.find(
              partnerName => partnerName !== name,
            )
            this.server.to(socket.id).emit('cupidResult', {
              lover: partner,
              winner: matchedPairs
                .filter(pair => !pair.pair.includes(name))
                .map(pair => pair.pair),
            })
          } else {
            this.server
              .to(socket.id)
              .emit('cupidResult', { lover: '0', winner: [] })
          }

          this.server
            .to(socket.id)
            .emit('chooseResult', { message: chooseData })
        })
      }
    } else {
      console.error('세션에러입니다')
    }
  }

  @SubscribeMessage('party-ready')
  handlePartyReady(client: Socket) {}

  @SubscribeMessage('party-cancel')
  handlePartyCancel(client: Socket) {}

  @SubscribeMessage('party-choose')
  handlePartyChoose(client: Socket) {}
}
