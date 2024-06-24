import { Module } from '@nestjs/common'
import { AwsController } from './aws.controller'
import { AwsService } from './aws.service'
import { JwtAuthRestGuard } from '../guards/jwt-auth.rest.guard'
import { JwtService } from '@nestjs/jwt'

@Module({
  controllers: [AwsController],
  providers: [AwsService, JwtService, JwtAuthRestGuard],
})
export class AwsModule {}
