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
    private readonly openviduService: OpenViduService,
    private readonly queueService: QueueService,
    private readonly configService: ConfigService,
  ) {
    this.isDevelopment = this.configService.get<string>('NODE_ENV') === 'dev'
  }
  private connectedUsers: { [nickname: string]: Socket } = {} // nickname: socketId 형태로 변경
  private connectedSockets: { [socketId: string]: string } = {} // socketId: nickname 형태로 변경
  private cupidFlag: Map<string, boolean> = new Map()
  private lastCupidFlag: Map<string,boolean> = new Map()

  private acceptanceStatus: Record<string, boolean> = {};
  afterInit(server: Server) {
    this.openviduService.server = server
    console.log('WebSocket initialized')
  }

  handleConnection(client: Socket) {}

  handleDisconnect(client: Socket) {
    const sessions = this.openviduService.getSessions()
    const participantName = this.connectedSockets[client.id]
    if (!sessions.length) {
      const gender = client['user'].gender
      this.queueService.removeParticipant(participantName, gender)
    }

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

    const nickname = this.connectedSockets[client.id];
    if (nickname in this.acceptanceStatus) {
      delete this.acceptanceStatus[nickname];
    }
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
      this.connectedUsers[participantName] = client
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
    // 해당 소켓이 존재하는 방을 찾기 위함
    const sessionName = this.roomid.get(payload.sender)
    if (sessionName) {
      this.openviduService.storeChoose(
        sessionName,
        payload.sender,
        payload.receiver,
      )
      const chooseData = this.openviduService.getChooseData(sessionName)
      // [{jinyong : test}, {test,jinyong}, {test1 : test2}, {test2: test3}]
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
        this.openviduService.removeChooseData(sessionName);
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


  // 1. 10초 이내에 '1대1화상채팅하기' 버튼을 누르지 않으면 비활성
  // 2. 성공적으로 '1대1화상채팅하기' 버튼을 눌렀을 경우 클라이언트 -> 서버(Event : chooseCam)
  @SubscribeMessage('lastChoose')
  handleChooseCam(client: Socket, payload: { sender : string; receiver: string })
  { // 서버 입장에서 소켓이 존재하는 방을 찾기 위함
    const { sender, receiver }  = payload
    const sessionName = this.roomid.get(sender)
    // 기존 정보가 있다면 새롭게 변형해서 저장할 수 있음
    if (sessionName) {
      this.openviduService.storeChoose(
        sessionName,
        sender,
        receiver,
      )
      // 방과 일치하는 매칭결과 정보 가져오기
      const chooseData = this.openviduService.getChooseData(sessionName);
      if ( chooseData.length === 6) {
        // 방과 일치하는 참여자 정보 가져오기
        const participant = this.openviduService.getParticipants(sessionName);
        // 매칭된 쌍의 정보를 가지고 있음
        // [
        // { pair: [ 'Alice', 'Bob' ] },
        // { pair: [ 'Charlie', 'David' ] },
        // { pair: [ 'Eve', 'Frank' ] }
        // ]
        const matches = this.openviduService.findMatchingPairs(sessionName);

        if (this.lastCupidFlag.get(sessionName) == undefined) {
          participant.forEach( ({socket, name }) => {

            const matchedPair = matches.find(elem => elem.pair.includes(name))
            if (matchedPair) {
              const partner = matchedPair.pair.find( elem => elem !== name)
              this.server.to(socket.id).emit('matching', { lover : partner })
            } else {
              this.server.to(socket.id).emit('matching', { lover : '0'})
            }

            this.server.to(socket.id).emit('lastChooseResult', chooseData)
          })
          this.lastCupidFlag.set(sessionName, true)
        }
      }
    } else {
      console.error('세션이 존재하지 않습니다.')
    }
  }

  @SubscribeMessage('moveToPrivateRoom')
  async handleMoveToPrivateRoom(client: Socket, payload : {sessionName:string; myName:string; partnerName:string})
  { 
    
    const { sessionName, myName, partnerName } = payload;
    const participant = this.openviduService.getParticipants(sessionName);
    if (this.acceptanceStatus[partnerName] === true) {
      const newSessionName = `${myName}-${partnerName}`;
      const newSession = await this.openviduService.createSession(newSessionName);

      const partner = await participant.find(participant => participant.name === partnerName )
      this.openviduService.addParticipant(newSessionName, myName, client);
      this.openviduService.addParticipant(newSessionName, partnerName, partner.socket);

      const enterToken = await this.openviduService.generateTokens(newSessionName);

      const myToken = enterToken.find(elem => elem.participant === myName).token;
      const partnerToken = enterToken.find(elem => elem.participant === partnerName).token;

      if (myToken && partnerToken) {
        this.server.to(client.id).emit('choice', { sessionId: newSessionName, token: myToken });
        this.server.to(partner.socket.id).emit('choice', { sessionId: newSessionName, token: partnerToken });
      } else {
        console.error("방 생성 실패!");
      }
    } else {
      this.acceptanceStatus[myName] = true;
    }
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
