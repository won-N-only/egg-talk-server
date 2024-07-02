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
import { OpenViduService } from './meeting.service'
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
  constructor(private readonly openviduService: OpenViduService) {}
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
        // this.roomid.set(participantName, sessionName)
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
        if (this.cupidFlag.get(sessionName) == undefined) {
          participants.forEach(({ socket, name }) => {
            // 매칭된 사람이 있는지 체크
            const matchedPair = matches.find(match => match.pair.includes(name))
            if (matchedPair) {
              const partner = matchedPair.pair.find(
                partnerName => partnerName !== name,
              )
              this.server.to(socket.id).emit('cupidResult', {
                lover: partner,
                loser: participants
                  .filter(
                    participant =>
                      !matchedPairs.some(pair =>
                        pair.pair.includes(participant.name),
                      ),
                  )
                  .map(participant => participant.name),
              })
            } else {
              this.server.to(socket.id).emit('cupidResult', {
                lover: '0',
                loser: participants
                  .filter(
                    participant =>
                      !matchedPairs.some(pair =>
                        pair.pair.includes(participant.name),
                      ),
                  )
                  .map(participant => participant.name),
              })
            }

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

    this.openviduService.saveDrawing(sessionName, userName, drawing)

    const drawings = this.openviduService.getDrawings(sessionName)

    if (Object.keys(drawings).length === 6) {
      const participants = this.openviduService.getParticipants(sessionName)
      participants.forEach(({ socket }) => {
        this.server.to(socket.id).emit('drawingSubmit', drawings)
      })
      /**emit 방식 추후 수정 예정 */
      // this.server.to(sessionName).emit('drawingSubmit', drawings)
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
      // this.server.to(sessionName).emit('voteResults', { winner })
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
    // this.server.to(sessionName).emit('finalResults', {
    // winners: winners, losers: losers,})
  }
}
