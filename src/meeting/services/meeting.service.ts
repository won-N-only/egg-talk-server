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

  generateSessionName() {
    return uuidv4()
  }

  async createSession(sessionName: string): Promise<Session> {
    if (!this.sessions[sessionName]) {
      try {
        const session = await this.openvidu.createSession({
          customSessionId: sessionName,
        })

        this.sessions[sessionName] = { session, participants: [] }
        console.log(`Session created: ${sessionName}, ID: ${session.sessionId}`)
        return session
      } catch (error) {
        console.error('Error creating session:', error)
        throw error
      }
    } else {
      console.log(`Session already exists: ${sessionName}`)
      return this.sessions[sessionName].session
    }
  }

  async deleteSession(sessionName: string): Promise<void> {
    if (this.sessions[sessionName]) {
      delete this.sessions[sessionName]
      console.log(`Session deleted: ${sessionName}`)
    } else {
      console.error(`Session ${sessionName} does not exist`)
    }
  }

  addParticipant(sessionName: string, participantName: string, socket: any) {
    // gender별로 나눠야할 것 같음
    if (this.sessions[sessionName]) {
      this.sessions[sessionName].participants.push({
        name: participantName,
        socket,
      })
    } else {
      console.error(`Session ${sessionName} does not exist`)
    }
  }

  removeParticipant(sessionName: string, socket: any, myid: string) {
    if (this.sessions[sessionName]) {
      // console.log(this.sessions[sessionName].participants.map(p => p.name))
      const participants = this.getParticipants(sessionName)
      this.sessions[sessionName].participants = participants.filter(
        p => p.name !== myid,
      )
      if (this.sessions[sessionName].participants.length === 0) {
        this.clearSessionData(sessionName)
      }
    } else {
      console.error(`Session ${sessionName} does not exist`)
    }
  }

  clearSessionData(sessionName: string) {
    console.log(`Clearing session data for ${sessionName}`)
    delete this.chooseData[sessionName]
    delete this.sessions[sessionName]
    delete this.sessionTimers[sessionName]
  }

  getParticipants(sessionName: string) {
    return this.sessions[sessionName]
      ? this.sessions[sessionName].participants
      : []
  }

  async generateTokens(sessionName: string) {
    const session = this.sessions[sessionName]?.session
    if (!session) {
      console.error(`No session found for ${sessionName}`)
      return []
    }

    const tokenPromises = this.sessions[sessionName].participants.map(
      async ({ name }) => {
        const tokenOptions = {
          role: OpenViduRole.PUBLISHER,
          data: name,
        }
        try {
          console.log(
            `Generating token for session: ${sessionName}, participant: ${name}`,
          )
          const token = await session.generateToken(tokenOptions)
          console.log(`Token generated: ${token}`)
          return token
        } catch (error) {
          console.error(
            `Error generating token for session: ${sessionName}, participant: ${name}`,
            error,
          )
          throw error
        }
      },
    )

    try {
      const tokens = await Promise.all(tokenPromises)
      return this.sessions[sessionName].participants.map(
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

  async resetParticipants(sessionName: string) {
    if (this.sessions[sessionName]) {
      const newSessionName = this.generateSessionName()
      const newSession = await this.createSession(newSessionName)
      this.sessions[newSessionName] = { session: newSession, participants: [] }
      console.log(
        `Session ${sessionName} reset and new session ${newSessionName} created with ID ${newSession.sessionId}`,
      )
    } else {
      console.error(`Session ${sessionName} does not exist`)
    }
  }

  getSession(sessionName: string) {
    return this.sessions[sessionName]?.session
  }

  async startVideoChatSession(sessionName: string) {
    try {
      const tokens = await this.generateTokens(sessionName)
      const session = this.getSession(sessionName)
      const participants = this.getParticipants(sessionName)

      if (!session) {
        console.error(
          `No session found for ${sessionName} during startVideoChatSession`,
        )
        return
      }
      tokens.forEach(({ participant, token }, index) => {
        const participantSocket =
          this.getParticipants(sessionName)[index].socket
        participantSocket.emit('startCall', {
          sessionId: session.sessionId,
          token: token,
          participantName: participant,
        })
      })

      await this.resetParticipants(sessionName)
    } catch (error) {
      console.error('Error generating tokens: ', error)
    }
  }
  startSessionTimer(sessionName: string, server: Server) {
    const timers = [
      { time: 0.5, event: 'introduce' },
      { time: 2, event: 'keyword' },
      { time: 3, event: 'cupidTime' },
      { time: 4, event: 'cam' },
      { time: 5, event: 'drawingContest' },
      { time: 6, event: 'lastCupidTime' },
      { time: 40, event: 'finish' },
    ]
    // 언젠가 세션 같은 방을 만날 수도 있어서 초기화를 시킴
    // 만약 겹치지 않는다면, 아래 코드는 지워도 무방
    if (this.sessionTimers[sessionName]) {
      clearTimeout(this.sessionTimers[sessionName])
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
            const TeamArray = this.getParticipants(sessionName).map(
              user => user.name,
            ) // 유저 닉네임 가져옴
            const RandomTeamArray = this.shuffleArray(TeamArray) // 유저를 랜덤으로 셔플함
            console.log(RandomTeamArray)
            message = null // 셔플한 랜덤 유저 Array를 Message에 담음
            console.log(message)
            console.log('성공 !!!!!!!!!!!!!!!!!')
            messageArray = RandomTeamArray
          } else {
            message = `${event}`
          }
          this.notifySessionParticipants(
            sessionName,
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
    sessionName: string,
    eventType: string,
    message: string,
    server: Server,
    messageArray?: string[],
  ) {
    const participants = this.getParticipants(sessionName)
    if (eventType == 'keyword') {
      const getRandomParticipant =
        participants[Math.floor(Math.random() * participants.length)].name
      participants.forEach(({ socket }) => {
        server.to(socket.id).emit(eventType, { message, getRandomParticipant })
      })
    } else if (eventType == 'introduce') {
      participants.forEach(({ socket }) => {
        server.to(socket.id).emit(eventType, messageArray)
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

  storeChoose(sessionName: string, sender: string, receiver: string) {
    if (!this.chooseData[sessionName]) {
      this.chooseData[sessionName] = []
    }

    // 기존 선택이 있는지 확인하고 업데이트
    const existingChoiceIndex = this.chooseData[sessionName].findIndex(
      choice => choice.sender === sender,
    )
    if (existingChoiceIndex !== -1) {
      this.chooseData[sessionName][existingChoiceIndex].receiver = receiver
    } else {
      this.chooseData[sessionName].push({ sender, receiver })
    }
  }

  removeChooseData(sessionName: string) {
    if (!this.chooseData[sessionName]){
      delete this.chooseData[sessionName];
    }
  }

  getChooseData(sessionName: string) {
    return this.chooseData[sessionName] || []
  }

  findMatchingPairs(sessionName: string) {
    const chooseData = this.getChooseData(sessionName)
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

  /**<sessionName, <username, drawing>> */
  private drawings: Record<string, Record<string, string>> = {}

  saveDrawing(sessionName: string, userName: string, drawing: string) {
    if (!this.drawings[sessionName]) this.drawings[sessionName] = {}
    this.drawings[sessionName][userName] = drawing
  }

  getDrawings(sessionName: string): Record<string, string> {
    return this.drawings[sessionName] || {}
  }

  resetDrawings(sessionName: string): void {
    delete this.drawings[sessionName]
  }

  /**<sessionName, <username, votedUser>> */
  private votes: Record<string, Record<string, string>> = {}

  saveVote(sessionName: string, userName: string, votedUserName: string) {
    if (!this.votes[sessionName]) this.votes[sessionName] = {}
    this.votes[sessionName][userName] = votedUserName
  }

  getVotes(sessionName: string): Record<string, string> {
    return this.votes[sessionName] || {}
  }

  calculateWinner(sessionName: string): string {
    /**저장했던 그림 삭제 */
    const voteCount: Record<string, number> = {}

    const votes = this.getVotes(sessionName)
    for (const vote in votes) {
      const votedUser = votes[vote]
      if (!voteCount[votedUser]) voteCount[votedUser] = 0
      voteCount[votedUser]++
    }

    const winner = Object.keys(voteCount).reduce((a, b) =>
      voteCount[a] > voteCount[b] ? a : b,
    )

    /**저장했던 투표 삭제 */
    delete this.votes[sessionName]
    return winner
  }
}
