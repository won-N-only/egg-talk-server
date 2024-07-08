import { Injectable } from '@nestjs/common'
import { OpenVidu, OpenViduRole, Session } from 'openvidu-node-client'
import { Socket, Server } from 'socket.io'
import { v4 as uuidv4 } from 'uuid'

@Injectable()
export class MeetingService {
  private openvidu: OpenVidu
  private sessions: Record<string, { session: Session; participants: any[] }> =
    {}
  private chooseData: Record<string, { sender: string; receiver: string }[]> =
    {}
  private lastChooseData: Record<string, { sender: string; receiver: string }> =
    {}
  private sessionTimers: Record<string, NodeJS.Timeout> = {}

  public server: Server

  constructor() {
    const OPENVIDU_URL = process.env.OPENVIDU_URL
    const OPENVIDU_SECRET = process.env.OPENVIDU_SECRET
    this.openvidu = new OpenVidu(OPENVIDU_URL, OPENVIDU_SECRET)
  }
  private shuffleArray<T>(array: T[]): T[] {
    for (let i = array.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1))
      ;[array[i], array[j]] = [array[j], array[i]]
    }
    return array
  }

  generateSessionId() {
    return uuidv4()
  }

  async createSession(sessionId: string): Promise<Session> {
    if (!this.sessions[sessionId]) {
      try {
        const session = await this.openvidu.createSession({
          customSessionId: sessionId,
        })

        this.sessions[sessionId] = { session, participants: [] }
        console.log(`Session created: ${sessionId}, ID: ${session.sessionId}`)
        return session
      } catch (error) {
        console.error('Error creating session:', error)
        throw error
      }
    } else {
      console.log(`Session already exists: ${sessionId}`)
      return this.sessions[sessionId].session
    }
  }

  async deleteSession(sessionId: string): Promise<void> {
    if (this.sessions[sessionId]) {
      delete this.sessions[sessionId]
      console.log(`Session deleted: ${sessionId}`)
    } else {
      console.error(`Session ${sessionId} does not exist`)
    }
  }

  addParticipant(sessionId: string, participantName: string, socket: any) {
    // gender별로 나눠야할 것 같음
    if (this.sessions[sessionId]) {
      this.sessions[sessionId].participants.push({
        name: participantName,
        socket,
      })
      console.log(
        '참여자가 추가되었습니다. 세션이름: ',
        sessionId,
        '참여자 이름 : ',
        participantName,
      )
    } else {
      console.error(`Session ${sessionId} does not exist`)
    }
  }

  removeParticipant(sessionId: string, socket: any, myid: string) {
    if (this.sessions[sessionId]) {
      // console.log(this.sessions[sessionId].participants.map(p => p.name))
      const participants = this.getParticipants(sessionId)
      this.sessions[sessionId].participants = participants.filter(
        p => p.name !== myid,
      )
      if (this.sessions[sessionId].participants.length === 0) {
        this.clearSessionData(sessionId)
      }
    } else {
      console.error(`Session ${sessionId} does not exist`)
    }
  }

  clearSessionData(sessionId: string) {
    console.log(`Clearing session data for ${sessionId}`)
    delete this.chooseData[sessionId]
    delete this.sessions[sessionId]
    delete this.sessionTimers[sessionId]
  }

  getParticipants(sessionId: string) {
    return this.sessions[sessionId]
      ? this.sessions[sessionId].participants
      : []
  }

  async generateTokens(sessionId: string) {
    const session = this.sessions[sessionId]?.session
    if (!session) {
      console.error(`No session found for ${sessionId}`)
      return []
    }

    const tokenPromises = this.sessions[sessionId].participants.map(
      async ({ name }) => {
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
      },
    )

    try {
      const tokens = await Promise.all(tokenPromises)
      return this.sessions[sessionId].participants.map(
        (participant, index) => ({
          participant: participant.name,
          token: tokens[index],
        }),
      )
    } catch (error) {
      console.error('Error generating tokens:', error)
      return []
    }
  }

  async resetParticipants(sessionId: string) {
    if (this.sessions[sessionId]) {
      const newSessionId = this.generateSessionId()
      const newSession = await this.createSession(newSessionId)
      this.sessions[newSessionId] = { session: newSession, participants: [] }
      console.log(
        `Session ${sessionId} reset and new session ${newSessionId} created with ID ${newSession.sessionId}`,
      )
    } else {
      console.error(`Session ${sessionId} does not exist`)
    }
  }

  getSession(sessionId: string) {
    return this.sessions[sessionId]?.session
  }

  async startVideoChatSession(sessionId: string) {
    try {
      const tokens = await this.generateTokens(sessionId)
      const session = this.getSession(sessionId)
      const participants = this.getParticipants(sessionId)

      if (!session) {
        console.error(
          `No session found for ${sessionId} during startVideoChatSession`,
        )
        return
      }
      tokens.forEach(({ participant, token }, index) => {
        const participantSocket =
          this.getParticipants(sessionId)[index].socket
        participantSocket.emit('startCall', {
          sessionId: session.sessionId,
          token: token,
          participantName: participant,
        })
      })

      await this.resetParticipants(sessionId)
    } catch (error) {
      console.error('Error generating tokens: ', error)
    }
  }
  startSessionTimer(sessionId: string, server: Server) {
    const timers = [
      { time: 0.5, event: 'introduce' },
      { time: 2, event: 'keyword' },
      { time: 3, event: 'cupidTime' },
      { time: 4, event: 'cam' },
      { time: 5, event: 'drawingContest' },
      { time: 6, event: 'lastCupidTime' },
      { time: 7, event: 'finish' },
    ]
    // 언젠가 세션 같은 방을 만날 수도 있어서 초기화를 시킴
    // 만약 겹치지 않는다면, 아래 코드는 지워도 무방
    console.log('세션타이머가 시작되었습니다 세션 이름은?? : ', sessionId)
    if (this.sessionTimers[sessionId]) {
      clearTimeout(this.sessionTimers[sessionId])
    }

    timers.forEach(({ time, event }) => {
      let messageArray: string[] | undefined

      setTimeout(
        () => {
          let message: string
          if (event === 'keyword') {
            const getRandomNumber = () => Math.floor(Math.random() * 20) + 1
            const number = getRandomNumber()
            message = `${number}`
          } else if (event === 'introduce') {
            console.log('현재 세션입니다 : ', this.getSession(sessionId))
            const TeamArray = this.getParticipants(sessionId).map(
              user => user.name,
            ) // 유저 닉네임 가져옴
            console.log('현재 팀 어레이입니다. : ', TeamArray)
            const RandomTeamArray = this.shuffleArray(TeamArray) // 유저를 랜덤으로 셔플함
            console.log('랜덤 팀 어레이입니다 : ', RandomTeamArray)
            message = null // 셔플한 랜덤 유저 Array를 Message에 담음
            console.log(message)
            console.log('성공 !!!!!!!!!!!!!!!!!')
            messageArray = RandomTeamArray
          } else {
            message = `${event}`
          }
          this.notifySessionParticipants(
            sessionId,
            event,
            message,
            server,
            messageArray,
          )
        },
        time * 50 * 1000,
      )
    })
  }

  notifySessionParticipants(
    sessionId: string,
    eventType: string,
    message: string,
    server: Server,
    messageArray?: string[],
  ) {
    const participants = this.getParticipants(sessionId)
    console.log('현재 참여자 목록입니다 => ', participants)
    if (eventType == 'keyword') {
      const getRandomParticipant = participants[1].name
      participants.forEach(({ socket }) => {
        server.to(socket.id).emit(eventType, { message, getRandomParticipant })
      })
    } else if (eventType == 'introduce') {
      participants.forEach(({ socket }) => {
        server.to(socket.id).emit(eventType, messageArray)
      })
    } else if (eventType == 'drawingContest') {
      const keywordsIndex = Math.random() * 1234
      participants.forEach(({ socket }) => {
        server.to(socket.id).emit(eventType, { message, keywordsIndex })
      })
    } else {
      participants.forEach(({ socket }) => {
        server.to(socket.id).emit(eventType, { message })
      })
    }
  }

  getSessions() {
    return this.sessions
  }

  storeChoose(sessionId: string, sender: string, receiver: string) {
    if (!this.chooseData[sessionId]) {
      this.chooseData[sessionId] = []
    }

    // 기존 선택이 있는지 확인하고 업데이트
    const existingChoiceIndex = this.chooseData[sessionId].findIndex(
      choice => choice.sender === sender,
    )
    if (existingChoiceIndex !== -1) {
      this.chooseData[sessionId][existingChoiceIndex].receiver = receiver
    } else {
      this.chooseData[sessionId].push({ sender, receiver })
    }
  }

  removeChooseData(sessionId: string) {
    if (this.chooseData[sessionId]) {
      delete this.chooseData[sessionId]
    }
  }

  getChooseData(sessionId: string) {
    return this.chooseData[sessionId] || []
  }

  findMatchingPairs(sessionId: string) {
    const chooseData = this.getChooseData(sessionId)
    const matches = []
    chooseData.forEach(({ sender, receiver }) => {
      const isPair = chooseData.find(
        choice => choice.sender === receiver && choice.receiver === sender,
      )
      if (isPair) {
        // matches = [ { pair : [jinyong, test] }]
        matches.push({ pair: [sender, receiver] })
      }
    })
    return matches
  }

  /**<sessionId, <username, drawing>> */
  private drawings: Record<string, Record<string, string>> = {}

  saveDrawing(sessionId: string, userName: string, drawing: string) {
    if (!this.drawings[sessionId]) this.drawings[sessionId] = {}
    this.drawings[sessionId][userName] = drawing
  }

  getDrawings(sessionId: string): Record<string, string> {
    return this.drawings[sessionId] || {}
  }

  resetDrawings(sessionId: string): void {
    delete this.drawings[sessionId]
  }

  /**<sessionId, <username, phtos>> */
  private photos: Record<string, Record<string, string>> = {}

  savePhoto(sessionId: string, userName: string, photo: string) {
    if (!this.photos[sessionId]) this.photos[sessionId] = {}
    this.photos[sessionId][userName] = photo
  }

  getPhotos(sessionId: string, userName: string) {
    return this.photos[sessionId] || {}
  }

  /**<sessionId, <username, votedUser>> */
  private votes: Record<string, Record<string, string>> = {}

  saveVote(sessionId: string, userName: string, votedUserName: string) {
    if (!this.votes[sessionId]) this.votes[sessionId] = {}
    this.votes[sessionId][userName] = votedUserName
  }

  getVotes(sessionId: string): Record<string, string> {
    return this.votes[sessionId] || {}
  }

  calculateWinner(sessionId: string): { winner: string; losers: string[] } {
    /**저장했던 그림 삭제 */
    const voteCount: Record<string, number> = {}

    const votes = this.getVotes(sessionId)
    for (const vote in votes) {
      const votedUser = votes[vote]
      if (!voteCount[votedUser]) voteCount[votedUser] = 0
      voteCount[votedUser]++
    }

    const winner = Object.keys(voteCount).reduce((a, b) =>
      voteCount[a] > voteCount[b] ? a : b,
    )

    const losers = Object.keys(votes).filter(user => user !== winner)

    delete this.votes[sessionId]
    return { winner, losers }
  }
}
