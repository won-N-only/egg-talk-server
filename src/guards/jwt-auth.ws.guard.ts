import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import { Socket } from 'socket.io'

@Injectable()
export class JwtAuthWsGuard implements CanActivate {
  constructor(private readonly jwtService: JwtService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const client = context.switchToWs().getClient<Socket>()
    const token = this.extractTokenFromCookie(client)

    if (!token) {
      throw new UnauthorizedException('Token not found')
    }

    try {
      client['user'] = await this.jwtService.verifyAsync(token, {
        secret: process.env.JWT_SECRET,
      })
    } catch {
      throw new UnauthorizedException('Invalid token')
    }

    return true
  }

  private extractTokenFromCookie(client: Socket): string | undefined {
    const cookies = client.handshake.headers.cookie
    if (!cookies) {
      return undefined
    }

    const jwtCookie = cookies
      .split(';')
      .find(c => c.trim().startsWith('access_token='))
    if (!jwtCookie) {
      return undefined
    }

    return jwtCookie.split('=')[1]
  }
}
