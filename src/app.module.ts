import { Module } from '@nestjs/common'
import { AppController } from './app.controller'
import { AppService } from './app.service'
import { UsersController } from './users/users.controller';
import { UsersService } from './users/users.service';
import { AuthService } from './auth/auth.service';
import { AuthController } from './auth/auth.controller';
import { UsersModule } from './users/users.module';
import { AuthModule } from './auth/auth.module';
import { AwsController } from './aws/aws.controller';
import { AwsService } from './aws/aws.service';
import { AwsModule } from './aws/aws.module';

@Module({
  imports: [UsersModule, AuthModule, AwsModule],
  controllers: [AppController, UsersController, AuthController, AwsController],
  providers: [AppService, UsersService, AuthService, AwsService],
})
export class AppModule {}
