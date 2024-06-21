import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Chat, ChatDocument } from '../entities/chat.entity';
import { ChatRoom, ChatRoomDocument } from '../entities/chat-room.entity';


@Injectable()
export class CommonService {
  constructor(
    @InjectModel(ChatRoom.name) private chatRoomModel: Model<ChatRoomDocument>,
    @InjectModel(Chat.name) private chatModel: Model<ChatDocument>
  ) {}

  async getChatHistory(chatRoomId: string, userId:string): Promise<Chat[]> {
    // 1. ChatRoom ObjectId로 변환
    const chatRoomIdObj = new Types.ObjectId(chatRoomId);

    // 2. 해당 ChatRoom의 chats 배열 가져오기
    const chatRoom = await this.chatRoomModel.findById(chatRoomIdObj).exec();
    const chatIds = chatRoom?.chats || []; // chatRoom이 없으면 빈 배열

    // 3. Chat 배열 조회 및 populate
    const chats = await this.chatModel
    .find({ _id: { $in: chatIds } }) // chatIds에 속하는 Chat만 조회
    .populate('sender', 'username') // sender 정보 populate (필요한 경우)
    .sort({ createdAt: 1 }) // createdAt 기준 오름차순 정렬
    .exec();

    // 4. 채팅방에 들어갔다 = 안읽은 메세지 읽음 처리해야함 ( * 상대방이 보낸것만 읽음 처리 )
    await this.chatModel.updateMany(
      {
        _id: { $in: chatIds },
        sender: { $ne: userId }, // 본인이 보낸 메시지 제외
      },
      { $set: { isRead: true } }
    );
    return chats;
  }

  async sendMessage(senderId: string, chatRoomId: string, message: string): Promise<Chat> {
    try {
      // 1. 메시지 저장
      const newChat = await this.chatModel.create({
        sender:senderId,
        message,
      });

      // 2. ChatRoom 업데이트
      await this.chatRoomModel.findByIdAndUpdate(chatRoomId, {
        $push: { chats: newChat._id },
        // $set: {isRead : false}
      });

      return newChat;
    } catch (error) {
      console.error('메시지 저장 실패:', error);
      throw error; // 에러를 상위 호출자에게 전달
    }
  }
}
