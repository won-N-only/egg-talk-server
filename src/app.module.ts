import { Module } from '@nestjs/common'
import { AppController } from './app.controller'
import { AppService } from './app.service'
import { UsersController } from './users/users.controller'
import { UsersService } from './users/users.service'
import { AuthService } from './auth/auth.service'
import { AuthController } from './auth/auth.controller'
import { UsersModule } from './users/users.module'
import { AuthModule } from './auth/auth.module'
import { AwsController } from './aws/aws.controller'
import { AwsService } from './aws/aws.service'
import { AwsModule } from './aws/aws.module'
import { ChatsController } from './chats/chats.controller'
import { ChatsService } from './chats/chats.service'
import { ChatsModule } from './chats/chats.module'
import { CommonGateway } from './common/common.gateway'
import { CommonService } from './common/common.service'
import { CommonModule } from './common/common.module'

@Module({
  imports: [UsersModule, AuthModule, AwsModule, ChatsModule, CommonModule],
  controllers: [
    AppController,
    UsersController,
    AuthController,
    AwsController,
    ChatsController,
  ],
  providers: [
    AppService,
    UsersService,
    AuthService,
    AwsService,
    ChatsService,
    CommonGateway,
    CommonService,
  ],
})
export class AppModule {}
