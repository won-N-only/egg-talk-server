import { Module } from '@nestjs/common'
import { CommonGateway } from './common.gateway'
import { CommonService } from './common.service'
import { CommonRepository } from './common.repository'
import { JwtAuthWsGuard } from '../guards/jwt-auth.ws.guard'
import { JwtService } from '@nestjs/jwt'

@Module({
  providers: [
    CommonGateway,
    CommonService,
    CommonRepository,
    JwtService,
    JwtAuthWsGuard,
  ],
})
export class CommonModule {}
