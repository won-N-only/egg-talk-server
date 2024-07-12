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
  private isDevelopment: boolean
  constructor(
    private readonly meetingService: MeetingService,
    private readonly queueService: QueueService,
    private readonly configService: ConfigService,
  ) {
    this.isDevelopment = this.configService.get<string>('NODE_ENV') === 'dev'
  }

  afterInit(server: Server) {
    this.meetingService.server = server
    console.log('WebSocket initialized')
  }

  handleConnection(client: Socket) {}

  async handleDisconnect(client: Socket) {
    const sessions = this.meetingService.getSessions()
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
        this.meetingService.removeParticipant(
          sessionId,
          client,
          participantName,
        )
      }
    }

    await this.meetingService.deleteConnectedSocket(client.id)
    await this.meetingService.deleteParticipantNameInSession(participantName)
    await this.meetingService.deleteAcceptanceStatus(client.id)
  }

  @SubscribeMessage('ready')
  async handleReady(
    client: Socket,
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
          client,
          participantName,
        )
        await this.meetingService.deleteParticipantNameInSession(
          participantName,
        )
      }

      const { sessionId, readyMales, readyFemales } =
        await this.queueService.handleJoinQueue(participantName, client, gender)

      console.log('레디일때의 sessionId은?? ', sessionId)
      if (sessionId && readyFemales && readyMales) {
        readyMales.forEach(male => {
          this.meetingService.setParticipantNameToSession(male.name, sessionId)
        })
        readyFemales.forEach(female => {
          this.meetingService.setParticipantNameToSession(
            female.name,
            sessionId,
          )
        })
      }
      await this.meetingService.setConnectedSocket(participantName, client)
    } catch (error) {
      console.log('Error handling join Queue request:', error)
    }
  }

  @SubscribeMessage('cancel')
  async handleCancel(
    client: Socket,
    payload: { participantName: string; gender: string },
  ) {
    const sessions = this.meetingService.getSessions()
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
        this.meetingService.removeParticipant(
          sessionId,
          client,
          participantName,
        )
      }
    }
    await this.meetingService.deleteConnectedSocket(client.id)
    await this.meetingService.deleteParticipantNameInSession(participantName)
  }

  @SubscribeMessage('choose')
  async handleChoose(
    client: Socket,
    payload: { sender: string; receiver: string },
  ) {
    // 해당 소켓이 존재하는 방을 찾기 위함
    const sessionId = await this.meetingService.getSessionIdByParticipantName(
      payload.sender,
    )
    if (sessionId) {
      await this.meetingService.storeChoose(
        sessionId,
        payload.sender,
        payload.receiver,
      )

      const chooseData = await this.meetingService.getChooseData(sessionId)
      if (chooseData.length === 2) {
        const participants = this.meetingService.getParticipants(sessionId)
        const matches = await this.meetingService.findMatchingPairs(sessionId)

        const matchedPairs = matches.map(match => ({
          pair: match.pair,
          others: matches.filter(p => p !== match),
        }))
        if (
          (await this.meetingService.getCupidFlagBySessionId(sessionId)) ==
          undefined
        ) {
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
          await this.meetingService.setCupidFlagBySessionId(sessionId)
        }
        await this.meetingService.removeChooseData(sessionId)
      }
    } else {
      console.error('세션에러입니다')
    }
  }

  @SubscribeMessage('startTimer')
  async handleStartTimer(client: Socket, payload: { sessionId: string }) {
    const { sessionId } = payload
    console.log(
      '현재 타이머가 시작되었나요? => ',
      await this.meetingService.getTimerFlagBySessionId(sessionId),
      '혹시 클라에서 온 세션 이름은?? ',
      sessionId,
    )
    if (
      (await this.meetingService.getTimerFlagBySessionId(sessionId)) ==
      undefined
    ) {
      console.log('타이머가 시작되었습니다.')
      this.meetingService.startSessionTimer(sessionId, this.server)
      await this.meetingService.setTimerFlagBySessionId(sessionId)
    }
  }

  @SubscribeMessage('forwardDrawing')
  async handleForwardDrawing(
    client: Socket,
    payload: { userName: string; drawing: string; photo: string },
  ) {
    const { drawing, userName, photo } = payload
    const sessionId =
      await this.meetingService.getSessionIdByParticipantName(userName)

    if (!sessionId) {
      console.error(`세션에 없는 유저이름임: ${userName}`)
      return
    }

    await this.meetingService.savePhoto(sessionId, userName, photo)
    await this.meetingService.saveDrawing(sessionId, userName, drawing)

    const drawings = await this.meetingService.getDrawings(sessionId)

    if (Object.keys(drawings).length === 2) {
      const participants = this.meetingService.getParticipants(sessionId)
      participants.forEach(({ socket }) => {
        this.server.to(socket.id).emit('drawingSubmit', drawings)
      })
      await this.meetingService.resetDrawings(sessionId)
    }
  }

  @SubscribeMessage('submitVote')
  async handleSubmitVote(
    client: Socket,
    payload: { userName: string; votedUser: string },
  ) {
    const { userName, votedUser } = payload
    const sessionId =
      await this.meetingService.getSessionIdByParticipantName(userName)
    await this.meetingService.saveVote(sessionId, userName, votedUser)

    const votes = await this.meetingService.getVotes(sessionId)

    if (Object.keys(votes).length === 2) {
      const { winner, losers } =
        await this.meetingService.calculateWinner(sessionId)
      const photos = await this.meetingService.getPhotos(sessionId)
      const participants = this.meetingService.getParticipants(sessionId)
      participants.forEach(({ socket }) => {
        this.server.to(socket.id).emit('voteResults', {
          winner,
          losers,
          photos: photos,
        })
      })
    }
  }

  @SubscribeMessage('winnerPrize')
  async handleWinnerPrize(
    client: Socket,
    payload: { userName: string; winners: string[]; losers: string[] },
  ) {
    const { userName, winners, losers } = payload
    const sessionId =
      await this.meetingService.getSessionIdByParticipantName(userName)
    const participants = this.meetingService.getParticipants(sessionId)

    if (userName === winners[0])
      participants.forEach(({ socket }) => {
        this.server.to(socket.id).emit('finalResults', { winners, losers })
      })
    await this.meetingService.resetPhotos(sessionId)
  }

  @SubscribeMessage('drawingOneToOne')
  handleDrawingOneToOne(
    client: Socket,
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

  // 1. 10초 이내에 '1대1화상채팅하기' 버튼을 누르지 않으면 비활성
  // 2. 성공적으로 '1대1화상채팅하기' 버튼을 눌렀을 경우 클라이언트 -> 서버(Event : chooseCam)
  @SubscribeMessage('lastChoose')
  async handleChooseCam(
    client: Socket,
    payload: { sender: string; receiver: string },
  ) {
    // 서버 입장에서 소켓이 존재하는 방을 찾기 위함
    const { sender, receiver } = payload
    const sessionId =
      await this.meetingService.getSessionIdByParticipantName(sender)
    // 기존 정보가 있다면 새롭게 변형해서 저장할 수 있음
    if (sessionId) {
      await this.meetingService.storeChoose(sessionId, sender, receiver)
      const chooseData = await this.meetingService.getChooseData(sessionId)
      if (chooseData.length === 2) {
        // 방과 일치하는 참여자 정보 가져오기
        const participant = this.meetingService.getParticipants(sessionId)
        // 매칭된 쌍의 정보를 가지고 있음
        // [
        // { pair: [ 'Alice', 'Bob' ] },
        // { pair: [ 'Charlie', 'David' ] },
        // { pair: [ 'Eve', 'Frank' ] }
        // ]
        const matches =await this.meetingService.findMatchingPairs(sessionId)

        if (
          (await this.meetingService.getLastCupidFlagBySessionId(sessionId)) ==
          undefined
        ) {
          participant.forEach(({ socket, name }) => {
            const matchedPair = matches.find(elem => elem.pair.includes(name))
            if (matchedPair) {
              const partner = matchedPair.pair.find(elem => elem !== name)
              this.server.to(socket.id).emit('matching', { lover: partner })
            } else {
              this.server.to(socket.id).emit('matching', { lover: '0' })
            }

            this.server.to(socket.id).emit('lastChooseResult', chooseData)
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
    client: Socket,
    payload: { sessionId: string; myName: string; partnerName: string },
  ) {
    const { sessionId, myName, partnerName } = payload
    const participant = this.meetingService.getParticipants(sessionId)
    const isAccepted =
      await this.meetingService.getAcceptanceStatus(partnerName)
    if (isAccepted === true) {
      console.log('===========handleMoveToPrivateRoom 1==================')
      // const newSessionId = `${myName}-${partnerName}`
      const newSessionId = this.meetingService.generateSessionId()

      await this.meetingService.createSession(newSessionId)

      const partner = participant.find(
        participant => participant.name === partnerName,
      )
      this.meetingService.addParticipant(newSessionId, myName, client)
      this.meetingService.addParticipant(
        newSessionId,
        partnerName,
        partner.socket,
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
          .to(partner.socket.id)
          .emit('choice', { sessionId: newSessionId, token: partnerToken })
      } else {
        console.error('방 생성 실패!')
      }
    } else {
      await this.meetingService.setAcceptanceStatus(partnerName)
      console.log('===========handleMoveToPrivateRoom 0==================')
    }
  }

  @SubscribeMessage('leave')
  async handleLeave(client: Socket, payload: { participantName: string }) {
    const { participantName } = payload
    const sessionId =
      await this.meetingService.getSessionIdByParticipantName(participantName)
    if (sessionId) {
      this.meetingService.removeParticipant(
        sessionId,
        client,
        payload.participantName,
      )
    }
    await this.meetingService.deleteParticipantNameInSession(participantName)
    await this.meetingService.deleteConnectedSocket(client.id)
    await this.meetingService.deleteTimerFlagBySessionId(sessionId)
    await this.meetingService.deleteCupidFlagBySessionId(sessionId)
    await this.meetingService.deleteLastCupidFlagBySessionId(sessionId)
  }

  @SubscribeMessage('emoji')
  async handleEmoji(
    client: Socket,
    payload: { nickname: string; emojiIndex: string },
  ) {
    const { nickname, emojiIndex } = payload
    const sessionId =
      await this.meetingService.getSessionIdByParticipantName(nickname)

    const participants = this.meetingService.getParticipants(sessionId)
    participants.forEach(({ socket }) => {
      this.server.to(socket.id).emit('emojiBroadcast', { nickname, emojiIndex })
    })
  }
}
