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
  private connectedUsers: { [nickname: string]: Socket } = {} // nickname: socket 형태로 변경
  private connectedSockets: { [socketId: string]: string } = {} // socketId: nickname 형태로 변경
  private cupidFlag: Map<string, boolean> = new Map()
  private lastCupidFlag: Map<string,boolean> = new Map()

  private acceptanceStatus: Record<string, boolean> = {};
  afterInit(server: Server) {
    this.openviduService.server = server
    console.log('WebSocket initialized')
  }

  handleConnection(client: Socket) {
    const nickname = client['user'].nickname
    this.connectedUsers[nickname] = client;
  }

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
    const nickname = client['user'].nickname
    delete this.connectedUsers[nickname];
  }

  // jwt사용시를 위한 코드
  // async handleReady(client: Socket) {
  //   try {
  //     const participantName = client['user'].participantName
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

      const sessionName =
        await this.openviduService.findOrCreateAvailableSession()
      if (sessionName) {
        console.log('Session successfully created or retrieved')
        await this.openviduService.handleJoinQueue(
          sessionName,
          participantName,
          client,
          gender,
        )
        this.roomid.set(participantName, sessionName)
        this.connectedUsers[participantName] = client
        this.connectedSockets[client.id] = participantName
      } else {
        console.error('Failed to create or retrieve session')
      }
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

    this.openviduService.removeFromQueue(participantName, gender)

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
  async handleMoveToPrivateRoom(client: Socket, payload : {sessionName:string; myName:string; parterName:string})
  {
    const { sessionName, myName, parterName } = payload;
    const participant = this.openviduService.getParticipants(sessionName);
    if (this.acceptanceStatus[parterName] === true) {
      const newSessionName = `${myName}-${parterName}`;
      const newSession = await this.openviduService.createSession(newSessionName);

      // const partnerSocket = await this.connectedUsers[parterName]; // 파트너 이름가지고 파트너의 소켓 아이디 가져오기
      const partner = await participant.find(participant => participant.name === parterName )
      this.openviduService.addParticipant(newSessionName, myName, client);
      this.openviduService.addParticipant(newSessionName, myName, partner.socket);

      const enterToken = await this.openviduService.generateTokens(newSessionName);

      const myToken = enterToken.find(elem => elem.participant === myName).token;
      const partnerToken = enterToken.find(elem => elem.participant === parterName).token;

      if (myToken && partnerToken) {
        this.server.to(client.id).emit('choice', { sessionName: newSessionName, token: myToken });
        this.server.to(partner.socket.id).emit('choice', { sessionName: newSessionName, token: partnerToken });
      } else {
        console.error("방 생성 실패!");
      }
    } else {
      this.acceptanceStatus[myName] = true;

      setTimeout(() => {
        if (this.acceptanceStatus[parterName] !== true ) {
          this.server.to(client.id).emit("acceptTimeout");
          this.acceptanceStatus[myName] = false;
        }
      }, 10000); // 10초 대기후 자동으로 false;
    }
  }
}
