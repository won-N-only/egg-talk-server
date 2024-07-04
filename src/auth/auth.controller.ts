import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  Res,
} from '@nestjs/common'
import { AuthService } from './auth.service'
import { ValidationPipe } from '../validation/validation.pipe'
import { CreateUserDto } from './dto/request/create-user.dto'
import { SignInUserDto } from './dto/request/signin-user.dto'
import { Response } from 'express'
import { MessageResponseDto } from '../common_dto/response/message.dto'

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('signUp')
  @HttpCode(HttpStatus.CREATED)
  async signUp(@Body(new ValidationPipe()) createUserDto: CreateUserDto) {
    return this.authService.create(createUserDto)
  }

  @Post('signIn')
  @HttpCode(HttpStatus.OK)
  async signIn(
    @Body(new ValidationPipe()) signInUserDto: SignInUserDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    const { access_token } = await this.authService.signIn(signInUserDto)
    response.cookie('access_token', access_token, {
      sameSite: 'none',
      path: '/',
      secure: true,
    })

    return new MessageResponseDto('Sign-in successful')
  }
}
