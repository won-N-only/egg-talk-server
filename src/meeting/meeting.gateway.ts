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
import { OpenViduService } from './services/meeting.service'
import { QueueService } from './services/queue.service'
import { JwtAuthWsGuard } from '../guards/jwt-auth.ws.guard'

@UseGuards(JwtAuthWsGuard)
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
  constructor(
    private readonly openviduService: OpenViduService,
    private readonly queueService: QueueService,
  ) {}
  private connectedUsers: { [nickname: string]: string } = {} // nickname: socketId 형태로 변경
  private connectedSockets: { [socketId: string]: string } = {} // socketId: nickname 형태로 변경
  private cupidFlag: Map<string, boolean> = new Map()
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
      const { participantName, gender } = payload

      const existingSessionName = this.roomid.get(participantName)
      if (existingSessionName) {
        this.openviduService.removeParticipant(
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
    const sessions = this.openviduService.getSessions()
    const { participantName, gender } = payload

    this.queueService.removeParticipant(participantName, gender)

    for (const sessionName in sessions) {
      if (sessions.hasOwnProperty(sessionName)) {
        this.openviduService.removeParticipant(
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
    payload: { userName: string; drawing: string; photo: string },
  ) {
    const { drawing, userName, photo } = payload
    const sessionName = this.roomid.get(userName)
    if (!sessionName) {
      console.error(`세션에 없는 유저이름임: ${userName}`)
      return
    }

    this.openviduService.savePhoto(sessionName, userName, photo)

    this.openviduService.saveDrawing(sessionName, userName, drawing)

    const drawings = this.openviduService.getDrawings(sessionName)

    if (Object.keys(drawings).length === 6) {
      const participants = this.openviduService.getParticipants(sessionName)
      participants.forEach(({ socket }) => {
        this.server.to(socket.id).emit('drawingSubmit', drawings)
      })
      this.openviduService.resetDrawings(sessionName)
    }
  }

  @SubscribeMessage('submitVote')
  handleSubmitVote(
    client: Socket,
    payload: { userName: string; votedUser: string },
  ) {
    const { userName, votedUser } = payload
    const sessionName = this.roomid.get(userName)
    this.openviduService.saveVote(sessionName, userName, votedUser)

    const votes = this.openviduService.getVotes(sessionName)

    if (Object.keys(votes).length === 6) {
      const winner = this.openviduService.calculateWinner(sessionName)
      const participants = this.openviduService.getParticipants(sessionName)
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
    const participants = this.openviduService.getParticipants(sessionName)
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
      this.openviduService.removeParticipant(
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
