import { Injectable, UnauthorizedException } from '@nestjs/common'
import { AuthRepository } from './auth.repository'
import { CreateUserDto } from './dto/request/create-user.dto'
import { SignInUserDto } from './dto/request/signIn-user.dto'
import { JwtService } from '@nestjs/jwt'
import * as bcrypt from 'bcrypt'

@Injectable()
export class AuthService {
  constructor(
    private readonly authRepository: AuthRepository,
    private readonly jwtService: JwtService,
  ) {}

  async create(createUserDto: CreateUserDto) {
    const hashedCreateUserDto = await this.hashPassword(createUserDto)
    const user = await this.authRepository.create(hashedCreateUserDto)

    return user._id
  }

  async signIn(signInUserDto: SignInUserDto) {
    const user = await this.authRepository.findOne({ id: signInUserDto.id })
    if (!user) {
      throw new UnauthorizedException('Id not found')
    }

    const passwordMatch = await bcrypt.compare(
      signInUserDto.password,
      user.password,
    )

    if (!passwordMatch) {
      throw new UnauthorizedException('Invalid credentials')
    }

    const payload = {
      _id: user._id,
      id: user.id,
      nickname: user.nickname,
      gender: user.gender,
    }

    return {
      access_token: this.jwtService.sign(payload, {
        secret: process.env.JWT_SECRET,
      }),
    }
  }

  private async hashPassword(
    createUserDto: CreateUserDto,
  ): Promise<CreateUserDto> {
    return {
      ...createUserDto,
      password: await bcrypt.hash(createUserDto.password, 10),
    }
  }
}
