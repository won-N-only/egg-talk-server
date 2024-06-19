import { Controller, UseGuards } from '@nestjs/common'
import { JwtAuthRestGuard } from '../guards/jwt-auth.rest.guard'

@UseGuards(JwtAuthRestGuard)
@Controller('aws')
export class AwsController {}
