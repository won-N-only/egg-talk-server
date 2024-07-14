import { Injectable } from '@nestjs/common'
import Redis from 'ioredis'

@Injectable()
export class DrawingContestService {
  private redis: Redis

  constructor() {
    this.redis = new Redis({
      host: process.env.REDIS_HOST,
      port: parseInt(process.env.REDIS_PORT, 10),
    })
  }

  // 그림대회 그림 관리
  async saveDrawing(
    sessionId: string,
    userName: string,
    drawing: string,
  ): Promise<void> {
    await this.redis.hset(`session:${sessionId}:drawings`, userName, drawing)
  }

  async getDrawings(sessionId: string): Promise<Record<string, string>> {
    return await this.redis.hgetall(`session:${sessionId}:drawings`)
  }

  // 그림대회 사진 관리
  async savePhoto(
    sessionId: string,
    userName: string,
    photo: string,
  ): Promise<void> {
    await this.redis.hset(`session:${sessionId}:photos`, userName, photo)
  }

  async getPhotos(sessionId: string): Promise<Record<string, string>> {
    return await this.redis.hgetall(`session:${sessionId}:photos`)
  }

  // 그림대회 투표 관리
  async saveVote(
    sessionId: string,
    userName: string,
    votedUserName: string,
  ): Promise<void> {
    await this.redis.hset(`session:${sessionId}:votes`, userName, votedUserName)
  }

  async getVotes(sessionId: string): Promise<Record<string, string>> {
    return await this.redis.hgetall(`session:${sessionId}:votes`)
  }

  async resetDrawingContest(sessionId: string) {
    await this.redis.del(`session:${sessionId}:drawings`)
    await this.redis.del(`session:${sessionId}:photos`)
    await this.redis.del(`session:${sessionId}:votes`)
  }

  async calculateWinner(
    sessionId: string,
  ): Promise<{ winner: string; losers: string[] }> {
    const voteCount: Record<string, number> = {}
    const votes = await this.getVotes(sessionId)
    for (const vote in votes) {
      const votedUser = votes[vote]
      if (!voteCount[votedUser]) voteCount[votedUser] = 0
      voteCount[votedUser]++
    }

    const winner = Object.keys(voteCount).reduce((a, b) =>
      voteCount[a] > voteCount[b] ? a : b,
    )
    const losers = Object.keys(votes).filter(user => user !== winner)

    return { winner, losers }
  }
}
