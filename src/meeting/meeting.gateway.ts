import { SubscribeMessage, WebSocketGateway } from '@nestjs/websockets'
import { UseGuards } from '@nestjs/common'
import { JwtAuthWsGuard } from '../guards/jwt-auth.ws.guard'

@UseGuards(JwtAuthWsGuard)
@WebSocketGateway({ namespace: 'meeting' })
export class MeetingGateway {
  @SubscribeMessage('message')
  handleMessage(client: any, payload: any): string {
    return 'Hello world!'
  }
}
