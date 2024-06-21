import { Injectable } from '@nestjs/common';
import { OpenVidu, OpenViduRole, Session } from 'openvidu-node-client';

@Injectable()
export class OpenViduService {
    private openvidu: OpenVidu;
    private sessions: Record<string, { session: Session, participants: any[] }> = {};

    constructor() {
        const OPENVIDU_URL = process.env.OPENVIDU_URL || 'http://localhost:4443';
        const OPENVIDU_SECRET = process.env.OPENVIDU_SECRET || 'MY_SECRET';
        this.openvidu = new OpenVidu(OPENVIDU_URL, OPENVIDU_SECRET);
    }

    generateSessionName() {
        return `session-${Date.now()}`;
    }

    async createSession(sessionName: string) {
        if (!this.sessions[sessionName] || !this.sessions[sessionName].session) {
            try {
                const session = await this.openvidu.createSession();
                this.sessions[sessionName] = { session, participants: [] };
                console.log(`Session created: ${sessionName}`);
                console.log(`Session ID: ${session.sessionId}`);
            } catch (error) {
                console.error('Error creating session:', error);
                throw error;
            }
        } else {
            console.log(`Session already exists: ${sessionName}`);
        }
        return this.sessions[sessionName]?.session;
    }

    addParticipant(sessionName: string, participantName: string, socket: any) {
        if (this.sessions[sessionName]) {
            this.sessions[sessionName].participants.push({ name: participantName, socket });
        } else {
            console.error(`Session ${sessionName} does not exist`);
        }
    }

    removeParticipant(sessionName: string, socket: any) {
        if (this.sessions[sessionName]) {
            this.sessions[sessionName].participants = this.sessions[sessionName].participants.filter(p => p.socket !== socket);
        } else {
            console.error(`Session ${sessionName} does not exist`);
        }
    }

    getParticipants(sessionName: string) {
        return this.sessions[sessionName] ? this.sessions[sessionName].participants : [];
    }

    async generateTokens(sessionName: string) {
        const session = this.sessions[sessionName]?.session;
        if (!session) {
            console.error(`No session found for ${sessionName}`);
            return [];
        }

        const tokenPromises = this.sessions[sessionName].participants.map(async ({ name }) => {
            const tokenOptions = {
                role: OpenViduRole.PUBLISHER,
                data: name,
            };
            try {
                return await session.generateToken(tokenOptions);
            } catch (error) {
                throw error;
            }
        });

        const tokens = await Promise.all(tokenPromises);
        return this.sessions[sessionName].participants.map((participant, index) => ({
            participant: participant.name,
            token: tokens[index],
        }));
    }

    resetParticipants(sessionName: string) {
        if (this.sessions[sessionName]) {
            // this.sessions[sessionName].participants = [];
            const newSessionName = this.generateSessionName();
            this.createSession(newSessionName).then(newSession => {
                this.sessions[newSessionName] = { session: newSession, participants: [] };
            }).catch(error => {
                console.error('Error creating new session', error);
            });
            // const newSessionName = this.generateSessionName();
            // this.createSession(newSessionName);
            // this.sessions[newSessionName] = { session: this.sessions[sessionName].session, participants: [] };
            // console.log(`Session ${sessionName} reset and new session ${newSessionName} created`);
        } else {
            console.error(`Session ${sessionName} does not exist`);
        }
    }

    getSession(sessionName: string) {
        return this.sessions[sessionName]?.session;
    }

    findOrCreateAvailableSession() {
        console.log("Finding or creating available session");
        // 기존 세션 중에 참가자 수가 6명 미만인 세션을 찾습니다.
        for (const sessionName in this.sessions) {
            if (this.sessions.hasOwnProperty(sessionName)) {
                if (this.sessions[sessionName].participants.length < 6) {
                    if (this.sessions[sessionName].participants.length == 5) {
                        // 5명이 있는 세션을 찾으면 기존 세션 이름을 반환하고,
                        // 새로운 세션 이름을 생성하여 준비합니다.
                        const before_sessionName = sessionName;
                        const newSessionName = this.generateSessionName();
                        console.log(`Creating new session: ${newSessionName} and returning existing session: ${before_sessionName}`);
                        this.createSession(newSessionName);
                        return before_sessionName;
                    } else {
                        // 5명 미만인 세션을 반환합니다.
                        console.log(`Returning existing session: ${sessionName}`);
                        return sessionName;
                    }
                }
            }
        }
        // 새로운 세션 이름을 생성하고 반환합니다.
        const newSessionName = this.generateSessionName();
        this.createSession(newSessionName);
        console.log(`Creating and returning new session: ${newSessionName}`);
        return newSessionName;
    }

    getSessions() {
        return this.sessions;
    }
}
