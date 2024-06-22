import {
  WebSocketGateway,
  SubscribeMessage,
  OnGatewayInit,
  OnGatewayConnection,
  OnGatewayDisconnect,
  WebSocketServer,
} from '@nestjs/websockets';
import { Body, UseGuards } from '@nestjs/common'
import { Server, Socket } from 'socket.io';
import { OpenViduService } from './meeting.service';

@WebSocketGateway({
  namespace: 'meeting',
  cors: {
    origin: '*', // 모든 출처에서의 요청 허용
    methods: ['GET', 'POST'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  },
})
export class MeetingGateway implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer() server: Server;

  constructor(private readonly openviduService: OpenViduService) { }

  afterInit(server: Server) {
    console.log('WebSocket initialized');
  }

  handleConnection(client: Socket) {
    console.log('New client connected');
  }

  handleDisconnect(client: Socket) {
    const sessions = this.openviduService.getSessions();
    for (const sessionName in sessions) {
      if (sessions.hasOwnProperty(sessionName)) {
        this.openviduService.removeParticipant(sessionName, client);
      }
    }
  }

  @SubscribeMessage('ready')
  async handleReady(client: Socket, payload: { participantName: string }) {
    try {
      const { participantName } = payload;
      const sessionName = await this.openviduService.findOrCreateAvailableSession();
      const session = await this.openviduService.createSession(sessionName);
      if (session) {
        console.log('Session successfully created or retrieved');
        await this.handleJoinQueue(sessionName, participantName, client);
      } else {
        console.error('Failed to create or retrieve session');
      }
    } catch (error) {
      console.log('Error handling join Queue request:', error);
    }
  }

  @SubscribeMessage('cancel')
  handleCancel(client: Socket) {
    const sessions = this.openviduService.getSessions();
    for (const sessionName in sessions) {
      if (sessions.hasOwnProperty(sessionName)) {
        this.openviduService.removeParticipant(sessionName, client);
      }
    }
  }

  async handleJoinQueue(sessionName: string, participantName: string, client: Socket) {
    this.openviduService.addParticipant(sessionName, participantName, client);

    const participants = this.openviduService.getParticipants(sessionName);
    console.log('Participant joined the queue: ', participantName);
    console.log('Current waiting participants: ', participants.map(p => p.name));
    console.log('Current number of waiting participants: ', participants.length);

    if (participants.length === 6) {
      await this.startVideoChatSession(sessionName);
    }
  }

  async startVideoChatSession(sessionName: string) {
    try {
      const tokens = await this.openviduService.generateTokens(sessionName);
      const session = this.openviduService.getSession(sessionName);
      if (!session) {
        console.error(`No session found for ${sessionName} during startVideoChatSession`);
        return;
      }
      tokens.forEach(({ participant, token }, index) => {
        const participantSocket = this.openviduService.getParticipants(sessionName)[index].socket;
        participantSocket.emit('startCall', {
          sessionId: session.sessionId,
          token: token,
          participantName: participant,
        });
      });
      await this.openviduService.resetParticipants(sessionName);
    } catch (error) {
      console.error('Error generating tokens: ', error);
    }
  }
}
