import {
  WebSocketGateway,
  SubscribeMessage,
  OnGatewayInit,
  OnGatewayConnection,
  OnGatewayDisconnect,
  WebSocketServer,
} from '@nestjs/websockets'
import { UseGuards } from '@nestjs/common'
import { Server, Socket } from 'socket.io'
import { MeetingService } from './services/meeting.service'
import { QueueService } from './services/queue.service'
import { ConfigService } from '@nestjs/config'
import { JwtAuthWsGuard } from '../guards/jwt-auth.ws.guard'

@UseGuards(JwtAuthWsGuard)
@WebSocketGateway({
  namespace: 'meeting',
  cors: {
    origin: [
      'http://localhost:3000',
      'https://egg-signal-app.syeong.link',
      'https://temp-git-main-hyeong1s-projects.vercel.app',
    ],
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
  private isDevelopment: boolean
  constructor(
    private readonly meetingService: MeetingService,
    private readonly queueService: QueueService,
    private readonly configService: ConfigService,
  ) {
    this.isDevelopment = this.configService.get<string>('NODE_ENV') === 'dev'
  }
  private connectedUsers: { [nickname: string]: string } = {} // nickname: socketId 형태로 변경
  private connectedSockets: { [socketId: string]: string } = {} // socketId: nickname 형태로 변경
  private cupidFlag: Map<string, boolean> = new Map()
  afterInit(server: Server) {
    this.meetingService.server = server
    console.log('WebSocket initialized')
  }

  handleConnection(client: Socket) {}

  handleDisconnect(client: Socket) {
    const sessions = this.meetingService.getSessions()
    const participantName = this.connectedSockets[client.id]
    if (!sessions.length) {
      const gender = client['user'].gender
      this.queueService.removeParticipant(participantName, gender)
    }

    for (const sessionName in sessions) {
      if (sessions.hasOwnProperty(sessionName)) {
        this.meetingService.removeParticipant(
          sessionName,
          client,
          participantName,
        )
      }
    }
    delete this.connectedSockets[client.id]
    delete this.connectedUsers[participantName]
    this.roomid.delete(participantName)
  }

  @SubscribeMessage('ready')
  async handleReady(
    client: Socket,
    payload: { participantName: string; gender: string },
  ) {
    try {
      let participantName
      let gender
      if (this.isDevelopment) {
        participantName = client['user'].nickname
        gender = client['user'].gender
      } else {
        participantName = payload.participantName
        gender = payload.gender
      }
      // const participantName = client['user'].nickname
      // const gender = client['user'].gender

      const existingSessionName = this.roomid.get(participantName)
      if (existingSessionName) {
        this.meetingService.removeParticipant(
          existingSessionName,
          client,
          participantName,
        )
        this.roomid.delete(participantName)
      }

      const { sessionName, readyMales, readyFemales } =
        await this.queueService.handleJoinQueue(participantName, client, gender)
      if (sessionName && readyFemales && readyMales) {
        readyMales.forEach(male => {
          this.roomid.set(male.name, sessionName)
        })
        readyFemales.forEach(female => {
          this.roomid.set(female.name, sessionName)
        })
      }
      this.connectedUsers[participantName] = client.id
      this.connectedSockets[client.id] = participantName
    } catch (error) {
      console.log('Error handling join Queue request:', error)
    }
  }

  @SubscribeMessage('cancel')
  handleCancel(
    client: Socket,
    payload: { participantName: string; gender: string },
  ) {
    const sessions = this.meetingService.getSessions()
    let participantName
    let gender
    if (this.isDevelopment) {
      participantName = client['user'].nickname
      gender = client['user'].gender
    } else {
      participantName = payload.participantName
      gender = payload.gender
    }

    this.queueService.removeParticipant(participantName, gender)

    for (const sessionName in sessions) {
      if (sessions.hasOwnProperty(sessionName)) {
        this.meetingService.removeParticipant(
          sessionName,
          client,
          participantName,
        )
      }
    }
    delete this.connectedSockets[client.id]
    delete this.connectedUsers[participantName]
    this.roomid.delete(participantName)
  }

  @SubscribeMessage('choose')
  handleChoose(client: Socket, payload: { sender: string; receiver: string }) {
    const sessionName = this.roomid.get(payload.sender)
    if (sessionName) {
      this.meetingService.storeChoose(
        sessionName,
        payload.sender,
        payload.receiver,
      )
      const chooseData = this.meetingService.getChooseData(sessionName)
      if (chooseData.length === 6) {
        const participants = this.meetingService.getParticipants(sessionName)
        const matches = this.meetingService.findMatchingPairs(sessionName)

        const matchedPairs = matches.map(match => ({
          pair: match.pair,
          others: matches.filter(p => p !== match),
        }))
        if (this.cupidFlag.get(sessionName) == undefined) {
          participants.forEach(({ socket, name }) => {
            // 매칭된 사람이 있는지 체크
            const matchedPair = matches.find(match => match.pair.includes(name))
            const partner = matchedPair
              ? matchedPair.pair.find(partnerName => partnerName !== name)
              : '0'

            const losers = participants
              .filter(
                participant =>
                  !matchedPairs.some(pair =>
                    pair.pair.includes(participant.name),
                  ),
              )
              .map(participant => participant.name)

            this.server.to(socket.id).emit('cupidResult', {
              lover: partner,
              loser: losers,
            })

            this.server
              .to(socket.id)
              .emit('chooseResult', { message: chooseData })
          })
          this.cupidFlag.set(sessionName, true)
        }
      }
    } else {
      console.error('세션에러입니다')
    }
  }

  @SubscribeMessage('forwardDrawing')
  handleFowardDrawing(
    client: Socket,
    payload: { userName: string; drawing: any },
  ) {
    const { drawing, userName } = payload
    const sessionName = this.roomid.get(userName)
    if (!sessionName) {
      console.error(`세션에 없는 유저이름임: ${userName}`)
      return
    }

    this.meetingService.saveDrawing(sessionName, userName, drawing)

    const drawings = this.meetingService.getDrawings(sessionName)

    if (Object.keys(drawings).length === 6) {
      const participants = this.meetingService.getParticipants(sessionName)
      participants.forEach(({ socket }) => {
        this.server.to(socket.id).emit('drawingSubmit', drawings)
      })
      this.meetingService.resetDrawings(sessionName)
    }
  }

  @SubscribeMessage('submitVote')
  handleSubmitVote(
    client: Socket,
    payload: { userName: string; votedUser: string },
  ) {
    const { userName, votedUser } = payload
    const sessionName = this.roomid.get(userName)
    this.meetingService.saveVote(sessionName, userName, votedUser)

    const votes = this.meetingService.getVotes(sessionName)

    if (Object.keys(votes).length === 6) {
      const winner = this.meetingService.calculateWinner(sessionName)
      const participants = this.meetingService.getParticipants(sessionName)
      participants.forEach(({ socket }) => {
        this.server.to(socket.id).emit('voteResults', { winner })
      })
    }
  }

  @SubscribeMessage('winnerPrize')
  handleWinnerPrize(
    client: Socket,
    payload: { winners: string[]; losers: string[] },
  ) {
    const { winners, losers } = payload
    const sessionName = this.roomid.get(winners[0])
    const participants = this.meetingService.getParticipants(sessionName)
    participants.forEach(({ socket }) => {
      this.server
        .to(socket.id)
        .emit('finalResults', { winners: winners, losers: losers })
    })
  }

  @SubscribeMessage('leave')
  handleLeave(client: Socket, payload: { participantName }) {
    const sessionName = this.roomid.get(payload.participantName)
    if (sessionName) {
      this.meetingService.removeParticipant(
        sessionName,
        client,
        payload.participantName,
      )
    }
    this.roomid.delete(payload.participantName)
    this.cupidFlag.delete(sessionName)
    delete this.connectedUsers[payload.participantName]
    delete this.connectedSockets[client.id]
  }
}
