import { Injectable } from '@nestjs/common';
import { OpenVidu, OpenViduRole, Session } from 'openvidu-node-client';

@Injectable()
export class OpenViduService {
    private openvidu: OpenVidu;
    private sessions: Record<string, { session: Session, participants: any[] }> = {};

    constructor() {
        const OPENVIDU_URL = process.env.OPENVIDU_URL;
        const OPENVIDU_SECRET = process.env.OPENVIDU_SECRET;
        this.openvidu = new OpenVidu(OPENVIDU_URL, OPENVIDU_SECRET);
    }

    generateSessionName() {
        return `session-${Date.now()}`;
    }

    async createSession(sessionName: string) {
        if (!this.sessions[sessionName] || !this.sessions[sessionName].session) {
            try {
                // 세션 새로 생성
                const session = await this.openvidu.createSession();
                this.sessions[sessionName] = { session, participants: [] };
                console.log(`Session created: ${sessionName}, ID: ${session.sessionId}`);
            } catch (error) {
                console.error('Error creating session:', error);
                throw error;
            }
        } else {
            // 세션이 현재 존재할때는 존재하는 곳에 보내줌
            return this.sessions[sessionName]?.session;
        }
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

    async resetParticipants(sessionName: string) {
        if (this.sessions[sessionName]) {
            const newSessionName = this.generateSessionName();
            const newSession = await this.createSession(newSessionName);
            this.sessions[newSessionName] = { session: newSession, participants: [] };
        } else {
            console.error(`Session ${sessionName} does not exist`);
        }
    }

    getSession(sessionName: string) {
        return this.sessions[sessionName]?.session;
    }

    async findOrCreateAvailableSession() {
        console.log("Finding or creating available session");
        for (const sessionName in this.sessions) {
            if (this.sessions.hasOwnProperty(sessionName)) {
                const participants = this.sessions[sessionName].participants;
                if (participants.length < 6) {
                    if (participants.length === 5) {
                        const newSessionName = this.generateSessionName();
                        await this.createSession(newSessionName);
                        console.log(`Returning existing session: ${sessionName} and preparing new session: ${newSessionName}`);
                        return sessionName;
                    } else {
                        console.log(`Returning existing session: ${sessionName}`);
                        return sessionName;
                    }
                }
            }
        }
        // 세션을 아예 맨 처음 만들때 이쪽으로 오게됨(최초 1회)
        const newSessionName = this.generateSessionName();
        await this.createSession(newSessionName);
        console.log(`Creating and returning new session: ${newSessionName}`);
        return newSessionName;
    }


    getSessions() {
        return this.sessions;
    }
}
