import {
  WebSocketGateway,
  SubscribeMessage,
  OnGatewayInit,
  OnGatewayConnection,
  OnGatewayDisconnect,
  WebSocketServer,
  MessageBody,
  ConnectedSocket,
} from '@nestjs/websockets'
import { UseGuards } from '@nestjs/common'
import { Server, Socket } from 'socket.io'
import { MeetingService } from './services/meeting.service'
import { QueueService } from './services/queue.service'
import { ConfigService } from '@nestjs/config'
import { TimerService } from './services/timer.service'
import { SessionService } from './services/session.service'
import { DrawingContestService } from './services/drawingContest.service'
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
  private isDevelopment: boolean
  private userCount = this.queueService.userQueueCount * 2
  constructor(
    private readonly meetingService: MeetingService,
    private readonly queueService: QueueService,
    private readonly configService: ConfigService,
    private readonly sessionService: SessionService,
    private readonly timerService: TimerService,
    private readonly drawingContestService: DrawingContestService,
  ) {
    this.isDevelopment = this.configService.get<string>('NODE_ENV') === 'dev'
  }

  afterInit(server: Server) {
    this.meetingService.server = server
    console.log('WebSocket initialized')
  }

  handleConnection(client: Socket) {}

  async handleDisconnect(@ConnectedSocket() client: Socket) {
    const sessions = this.sessionService.getSessions()
    const participantName =
      await this.meetingService.getParticipantNameBySocketId(client.id)
    console.log(
      '미팅 게이트웨이 디스커넥트입니다. 유저 이름은 : ',
      participantName,
    )

    const user = client['user']
    if (!Object.keys(sessions).length && user) {
      const gender = client['user'].gender
      this.queueService.removeParticipant(participantName, gender)
    }

    for (const sessionId in sessions) {
      if (sessions.hasOwnProperty(sessionId)) {
        this.meetingService.removeParticipant(sessionId, participantName)
      }
    }

    await this.meetingService.deleteConnectedSocket(client.id)
    await this.meetingService.deleteParticipantNameInSession(participantName)
    await this.meetingService.deleteAcceptanceStatus(client.id)
  }

  @SubscribeMessage('ready')
  async handleReady(
    @ConnectedSocket()
    client: Socket,
    @MessageBody()
    payload: { participantName: string; gender: string },
  ) {
    try {
      let participantName: string
      let gender: string
      if (this.isDevelopment) {
        participantName = client['user'].nickname
        gender = client['user'].gender
      } else {
        participantName = payload.participantName
        gender = payload.gender
      }

      const existingSessionId =
        await this.meetingService.getSessionIdByParticipantName(participantName)

      if (existingSessionId) {
        this.meetingService.removeParticipant(
          existingSessionId,
          participantName,
        )
        await this.meetingService.deleteParticipantNameInSession(
          participantName,
        )
      }

      const { sessionId, readyUsers } = await this.queueService.handleJoinQueue(
        participantName,
        client,
        gender,
      )

      console.log('레디일때의 sessionId은?? ', sessionId)
      if (sessionId && readyUsers) {
        readyUsers.forEach(user => {
          this.meetingService.setSessionIdToParticipant(user.name, sessionId)
        })
      }
      await this.meetingService.setConnectedSocket(participantName, client.id)
    } catch (error) {
      console.log('Error handling join Queue request:', error)
    }
  }

  @SubscribeMessage('cancel')
  async handleCancel(
    @ConnectedSocket()
    client: Socket,
    @MessageBody()
    payload: { participantName: string; gender: string },
  ) {
    const sessions = this.sessionService.getSessions()
    let participantName: string
    let gender: string
    if (this.isDevelopment) {
      participantName = client['user'].nickname
      gender = client['user'].gender
    } else {
      participantName = payload.participantName
      gender = payload.gender
    }

    this.queueService.removeParticipant(participantName, gender)

    for (const sessionId in sessions) {
      if (sessions.hasOwnProperty(sessionId)) {
        this.meetingService.removeParticipant(sessionId, participantName)
        await this.timerService.decrTimerCountBySessionId(sessionId)
      }
    }
  }

  @SubscribeMessage('choose')
  async handleChoose(
    @MessageBody()
    payload: {
      sender: string
      receiver: string
    },
  ) {
    const sessionId = await this.meetingService.getSessionIdByParticipantName(
      payload.sender,
    )
    if (sessionId) {
      await this.meetingService.setChooseData(
        sessionId,
        payload.sender,
        payload.receiver,
      )

      const chooseData = await this.meetingService.getChooseData(sessionId)
      if (Object.keys(chooseData).length === this.userCount) {
        const participants = this.sessionService.getParticipants(sessionId)
        const matches = await this.meetingService.findMatchingPairs(sessionId)

        const matchedPairs = matches.map(match => ({
          pair: match.pair,
          others: matches.filter(p => p !== match),
        }))

        if (!(await this.meetingService.getCupidFlagBySessionId(sessionId))) {
          participants.forEach(({ socketId, name }) => {
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

            this.server.to(socketId).emit('cupidResult', {
              lover: partner,
              loser: losers,
            })

            this.server
              .to(socketId)
              .emit('chooseResult', { message: chooseData })
          })
          await this.meetingService.setCupidFlagBySessionId(sessionId)
        }
        await this.meetingService.deleteChooseData(sessionId)
      }
    } else {
      console.error('세션에러입니다')
    }
  }

  @SubscribeMessage('startTimer')
  async handleStartTimer(@MessageBody() payload: { sessionId: string }) {
    const { sessionId } = payload

    await this.timerService.incrTimerCountBySessionId(sessionId)
    const currentCount =
      await this.timerService.getTimerCountBySessionId(sessionId)

    if (currentCount === this.userCount) {
      this.timerService.startSessionTimer(sessionId, this.server)
      this.timerService.deleteTimerCountBySessionId(sessionId)
    }
  }

  @SubscribeMessage('forwardDrawing')
  async handleForwardDrawing(
    @MessageBody()
    payload: {
      userName: string
      drawing: string
      photo: string
    },
  ) {
    const { drawing, userName, photo } = payload
    const sessionId =
      await this.meetingService.getSessionIdByParticipantName(userName)

    if (!sessionId) {
      console.error(`세션에 없는 유저이름임: ${userName}`)
      return
    }

    await this.drawingContestService.savePhoto(sessionId, userName, photo)
    await this.drawingContestService.saveDrawing(sessionId, userName, drawing)

    const drawings = await this.drawingContestService.getDrawings(sessionId)

    if (Object.keys(drawings).length === this.userCount) {
      const participants = this.sessionService.getParticipants(sessionId)
      participants.forEach(({ socketId }) => {
        this.server.to(socketId).emit('drawingSubmit', drawings)
      })
    }
  }

  @SubscribeMessage('submitVote')
  async handleSubmitVote(
    @MessageBody() payload: { userName: string; votedUser: string },
  ) {
    const { userName, votedUser } = payload
    const sessionId =
      await this.meetingService.getSessionIdByParticipantName(userName)
    await this.drawingContestService.saveVote(sessionId, userName, votedUser)

    const votes = await this.drawingContestService.getVotes(sessionId)

    if (Object.keys(votes).length === this.userCount) {
      const { winner, losers } =
        await this.drawingContestService.calculateWinner(sessionId)
      const photos = await this.drawingContestService.getPhotos(sessionId)
      const participants = this.sessionService.getParticipants(sessionId)
      participants.forEach(({ socketId }) => {
        this.server.to(socketId).emit('voteResults', {
          winner,
          losers,
          photos: photos,
        })
      })
    }
  }

  @SubscribeMessage('winnerPrize')
  async handleWinnerPrize(
    @MessageBody()
    payload: {
      userName: string
      winners: string[]
      losers: string[]
    },
  ) {
    const { userName, winners, losers } = payload
    const sessionId =
      await this.meetingService.getSessionIdByParticipantName(userName)
    const participants = this.sessionService.getParticipants(sessionId)
    this.drawingContestService.resetDrawingContest(sessionId)
    if (userName === winners[0])
      participants.forEach(({ socketId }) => {
        this.server.to(socketId).emit('finalResults', { winners, losers })
      })
  }

  @SubscribeMessage('drawingOneToOne')
  handleDrawingOneToOne(
    @ConnectedSocket()
    client: Socket,
    @MessageBody()
    payload: { userName: string; winners: string[]; losers: string[] },
  ) {
    const { userName, winners, losers } = payload
    let partner: string

    winners.includes(userName)
      ? (partner = winners.filter(u => u !== userName)[0])
      : (partner = '0')

    client.emit('cupidResult', {
      lover: partner,
      loser: losers,
    })
  }

  @SubscribeMessage('lastChoose')
  async handleChooseCam(
    @MessageBody() payload: { sender: string; receiver: string },
  ) {
    const { sender, receiver } = payload
    const sessionId =
      await this.meetingService.getSessionIdByParticipantName(sender)
    if (sessionId) {
      await this.meetingService.setChooseData(sessionId, sender, receiver)
      const chooseData = await this.meetingService.getChooseData(sessionId)
      if (Object.keys(chooseData).length === this.userCount) {
        const participant = this.sessionService.getParticipants(sessionId)
        const matches = await this.meetingService.findMatchingPairs(sessionId)

        if (
          !(await this.meetingService.getLastCupidFlagBySessionId(sessionId))
        ) {
          participant.forEach(({ socketId, name }) => {
            const matchedPair = matches.find(elem => elem.pair.includes(name))
            const partner = matchedPair
              ? matchedPair.pair.find(elem => elem !== name)
              : '0'

            this.server.to(socketId).emit('matching', { lover: partner })
            this.server.to(socketId).emit('lastChooseResult', chooseData)
          })
          await this.meetingService.setLastCupidFlagBySessionId(sessionId)
        }
      }
    } else {
      console.error('세션이 존재하지 않습니다.')
    }
  }

  @SubscribeMessage('moveToPrivateRoom')
  async handleMoveToPrivateRoom(
    @ConnectedSocket()
    client: Socket,
    @MessageBody()
    payload: { sessionId: string; myName: string; partnerName: string },
  ) {
    const { sessionId, myName, partnerName } = payload
    const participant = this.sessionService.getParticipants(sessionId)
    const isAccepted =
      await this.meetingService.getAcceptanceStatus(partnerName)
    if (isAccepted === true) {
      console.log('===========handleMoveToPrivateRoom 1==================')
      const newSessionId = this.sessionService.generateSessionId()

      await this.sessionService.createSession(newSessionId)

      const partner = participant.find(
        participant => participant.name === partnerName,
      )
      this.sessionService.addParticipant(newSessionId, myName, client.id)
      this.sessionService.addParticipant(
        newSessionId,
        partnerName,
        partner.socketId,
      )
      console.log('===========handleMoveToPrivateRoom 2==================')
      const enterToken = await this.meetingService.generateTokens(newSessionId)

      const myToken = enterToken.find(elem => elem.participant === myName).token
      const partnerToken = enterToken.find(
        elem => elem.participant === partnerName,
      ).token
      console.log('===========handleMoveToPrivateRoom 3==================')
      if (myToken && partnerToken) {
        this.server
          .to(client.id)
          .emit('choice', { sessionId: newSessionId, token: myToken })
        this.server
          .to(partner.socketId)
          .emit('choice', { sessionId: newSessionId, token: partnerToken })
      } else {
        console.error('방 생성 실패!')
      }
    } else {
      await this.meetingService.setAcceptanceStatus(myName)
      console.log('===========handleMoveToPrivateRoom 0==================')
    }
  }

  @SubscribeMessage('leave')
  async handleLeave(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { participantName: string },
  ) {
    const { participantName } = payload
    const sessionId =
      await this.meetingService.getSessionIdByParticipantName(participantName)
    if (sessionId) {
      this.meetingService.removeParticipant(sessionId, participantName)
    }
    await this.meetingService.deleteParticipantNameInSession(participantName)
    await this.meetingService.deleteConnectedSocket(client.id)
    await this.meetingService.deleteCupidFlagBySessionId(sessionId)
    await this.meetingService.deleteLastCupidFlagBySessionId(sessionId)
  }

  @SubscribeMessage('emoji')
  async handleEmoji(
    @MessageBody()
    payload: {
      nickname: string
      emojiIndex: string
    },
  ) {
    const { nickname, emojiIndex } = payload
    const sessionId =
      await this.meetingService.getSessionIdByParticipantName(nickname)

    const participants = this.sessionService.getParticipants(sessionId)
    participants.forEach(({ socketId }) => {
      this.server.to(socketId).emit('emojiBroadcast', { nickname, emojiIndex })
    })
  }
}
