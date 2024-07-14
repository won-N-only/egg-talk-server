import { Inject, Injectable } from '@nestjs/common'
import { OpenViduRole } from 'openvidu-node-client'
import { Server } from 'socket.io'
import Redis from 'ioredis'
import { SessionService } from './session.service'
import { TimerService } from './timer.service'
import { DrawingContestService } from './drawingContest.service'

type ChooseResult = {
  sender: string
  receiver: string
}

@Injectable()
export class MeetingService {
  public server: Server
  private redis: Redis

  constructor(
    private readonly sessionService: SessionService,
    private readonly timerService: TimerService,
    @Inject('REDIS') redis: Redis,
  ) {
    this.redis = redis
  }

  // 소켓 관리
  async getParticipantNameBySocketId(socketId: string): Promise<string | null> {
    return await this.redis.get(`socket:${socketId}:participantName`)
  }

  async setConnectedSocket(
    participantName: string,
    socketId: string,
  ): Promise<void> {
    await this.redis.set(`socket:${socketId}:participantName`, participantName)
  }

  async deleteConnectedSocket(socketId: string): Promise<void> {
    await this.redis.del(`socket:${socketId}:participantName`)
  }

  // 세션 관리
  async getSessionIdByParticipantName(
    participantName: string,
  ): Promise<string | null> {
    return await this.redis.get(`participant:${participantName}:sessionId`)
  }

  async setSessionIdToParticipant(
    participantName: string,
    sessionId: string,
  ): Promise<void> {
    await this.redis.set(`participant:${participantName}:sessionId`, sessionId)
  }

  async deleteParticipantNameInSession(participantName: string): Promise<void> {
    await this.redis.del(`participant:${participantName}:sessionId`)
  }

  // 큐피드 플래그
  async getCupidFlagBySessionId(sessionId: string): Promise<boolean | null> {
    const flag = await this.redis.get(`session:${sessionId}:cupidFlag`)
    return flag === 'true'
  }

  async setCupidFlagBySessionId(sessionId: string): Promise<void> {
    await this.redis.set(`session:${sessionId}:cupidFlag`, 'true')
  }

  async deleteCupidFlagBySessionId(sessionId: string): Promise<void> {
    await this.redis.del(`session:${sessionId}:cupidFlag`)
  }

  // 최종선택 플래그
  async getLastCupidFlagBySessionId(
    sessionId: string,
  ): Promise<boolean | null> {
    const flag = await this.redis.get(`session:${sessionId}:lastCupidFlag`)
    return flag === 'true'
  }

  async setLastCupidFlagBySessionId(sessionId: string): Promise<void> {
    await this.redis.set(`session:${sessionId}:lastCupidFlag`, 'true')
  }

  async deleteLastCupidFlagBySessionId(sessionId: string): Promise<void> {
    await this.redis.del(`session:${sessionId}:lastCupidFlag`)
  }

  // 1:1대화 수락 플래그
  async getAcceptanceStatus(partnerName: string): Promise<boolean | null> {
    const status = await this.redis.get(
      `partner:${partnerName}:acceptanceStatus`,
    )
    return status === 'true'
  }

  async setAcceptanceStatus(myName: string): Promise<void> {
    await this.redis.set(`partner:${myName}:acceptanceStatus`, 'true')
  }

  async deleteAcceptanceStatus(socketId: string): Promise<void> {
    const participantName = await this.getParticipantNameBySocketId(socketId)
    if (participantName) {
      await this.redis.del(`partner:${participantName}:acceptanceStatus`)
    }
  }

  removeParticipant(sessionId: string, myId: string) {
    this.sessionService.removeParticipant(sessionId, myId)
    if (this.sessionService.getParticipants(sessionId).length === 0) {
      this.clearSessionData(sessionId)
    }
  }

  async clearSessionData(sessionId: string) {
    console.log(`Clearing session data for ${sessionId}`)
    await this.deleteChooseData(sessionId)
    this.timerService.clearSessionTimer(sessionId)
    await this.deleteCupidFlagBySessionId(sessionId)
    await this.deleteLastCupidFlagBySessionId(sessionId)
    this.sessionService.deleteSession(sessionId)
  }

  async generateTokens(sessionId: string) {
    const session = this.sessionService.getSession(sessionId)
    if (!session) {
      console.error(`No session found for ${sessionId}`)
      return []
    }

    const tokenPromises = this.sessionService
      .getParticipants(sessionId)
      .map(async ({ name }) => {
        const tokenOptions = {
          role: OpenViduRole.PUBLISHER,
          data: name,
        }
        try {
          console.log(
            `Generating token for session: ${sessionId}, participant: ${name}`,
          )
          const token = await session.generateToken(tokenOptions)
          console.log(`Token generated: ${token}`)
          return token
        } catch (error) {
          console.error(
            `Error generating token for session: ${sessionId}, participant: ${name}`,
            error,
          )
          throw error
        }
      })

    try {
      const tokens = await Promise.all(tokenPromises)
      return this.sessionService
        .getParticipants(sessionId)
        .map((participant, index) => ({
          participant: participant.name,
          token: tokens[index],
        }))
    } catch (error) {
      console.error('Error generating tokens:', error)
      return []
    }
  }

  async startVideoChatSession(sessionId: string) {
    try {
      const tokens = await this.generateTokens(sessionId)

      tokens.forEach(({ participant, token }, index) => {
        const participantSocketId =
          this.sessionService.getParticipants(sessionId)[index].socketId
        this.server.to(participantSocketId).emit('startCall', {
          sessionId: sessionId,
          token: token,
          participantName: participant,
        })
      })
    } catch (error) {
      console.error('Error generating tokens: ', error)
    }
  }

  // 1:1 선택 결과
  async getChooseData(sessionId: string): Promise<ChooseResult[]> {
    const chooseData = await this.redis.hgetall(`choose:${sessionId}`)
    const result: ChooseResult[] = []

    for (const [sender, receiver] of Object.entries(chooseData)) {
      result.push({ sender, receiver })
    }
    return result
  }

  async setChooseData(sessionId: string, sender: string, receiver: string) {
    await this.redis.hset(`choose:${sessionId}`, sender, receiver)
  }

  async deleteChooseData(sessionId: string) {
    await this.redis.del(`choose:${sessionId}`)
  }

  async findMatchingPairs(
    sessionId: string,
  ): Promise<{ pair: [string, string] }[]> {
    const chooseData = await this.getChooseData(sessionId)
    const matches: { pair: [string, string] }[] = []

    for (const { sender, receiver } of chooseData) {
      const isPair = chooseData.find(
        choice => choice.sender === receiver && choice.receiver === sender,
      )
      if (isPair) {
        matches.push({ pair: [sender, receiver] })
      }
    }

    return matches
  }
}
