import { Inject,Injectable } from '@nestjs/common'
import { InjectModel } from '@nestjs/mongoose'
import { User, Friend } from '../entities/user.entity'
import { Model, Types, ObjectId } from 'mongoose'
import { AcceptFriend, AddFriendDto } from './dto/request/notification.dto'
import { ChatRoom } from '../entities/chat-room.entity'
import { Notification } from '../entities/notification.entity'
import { Chat } from '../entities/chat.entity'
import { CACHE_MANAGER } from '@nestjs/cache-manager'
import { Redis } from 'ioredis'
import { Cache } from 'cache-manager';
@Injectable()
export class CommonRepository {
  private redisClient: Redis

  constructor(
    @InjectModel(User.name) private readonly userModel: Model<User>,
    @InjectModel(ChatRoom.name) private readonly chatRoomModel: Model<ChatRoom>,
    @InjectModel(Chat.name) private chatModel: Model<Chat>,
    @InjectModel(Notification.name)
    private readonly notificationModel: Model<Notification>,
    @Inject(CACHE_MANAGER) private cacheManager: Cache,
  ) {
    this.redisClient = (this.cacheManager as any).store.getClient();
  }

  async getNotification(nickname: String): Promise<Notification[]> {
    await this.userModel.findOneAndUpdate(
      { nickname },
      {
        $set: { newNotification: false },
      },
    )

    const user = await this.userModel
      .findOne({ nickname })
      .populate<{ notifications: Notification[] }>('notifications')
      .lean()

    return user.notifications
  }

  async markNotification(data: AddFriendDto): Promise<Notification> {
    const { userNickname, friendNickname } = data
    const notification = new this.notificationModel({
      from: userNickname,
    })

    await this.userModel.findOneAndUpdate(
      { nickname: friendNickname },
      {
        $push: { notifications: notification._id },
      },
    )

    await notification.save()
    return notification
  }

  async getFriends(nickname: string): Promise<ObjectId[]> {
    return await this.userModel
      .findOne({ nickname }, { friends: 1, _id: 0 })
      .lean()
  }

  async acceptFriend(data: AcceptFriend): Promise<User> {
    const { userNickname, friendNickname, notificationId } = data
    const friend = await this.userModel.findOne({ nickname: friendNickname })
    if (!friend) throw new Error('없는 유저랍니다.')
    const notificationObjectId = new Types.ObjectId(notificationId)

    try {
      await this.userModel
        .findOneAndUpdate(
          { nickname: userNickname },
          { $pull: { notifications: notificationObjectId } },
          { new: true },
        )
        .exec()

      await this.notificationModel.deleteOne({ _id: notificationId })

      const newChatRoom = new this.chatRoomModel({ chats: [] })
      await newChatRoom.save()

      const newFriend: Friend = {
        friend: friendNickname,
        chatRoomId: newChatRoom._id,
        newMessage: false,
      }

      const newFriendForFriend: Friend = {
        friend: userNickname,
        chatRoomId: newChatRoom._id,
        newMessage: false,
      }

      await this.userModel.findOneAndUpdate(
        { nickname: friendNickname },
        { $push: { friends: newFriendForFriend } },
        { new: true },
      )

      const updatedUser = await this.userModel
        .findOneAndUpdate(
          { nickname: userNickname },
          { $push: { friends: newFriend } },
          { new: true },
        )
        .lean()

      return updatedUser
    } catch (error) {
      throw new Error('친구 추가 실패했어용.')
    }
  }

  // async getChatRoomMessage(chatRoomObjectId: Types.ObjectId) {
  //   const chatRoom = await this.chatRoomModel
  //     .findByIdAndUpdate(
  //       chatRoomObjectId,
  //       { $set: { isRead: true } },
  //       { new: true },
  //     )
  //     .lean()
  //     .exec()

  //   if (chatRoom) {
  //     return await this.chatRoomModel.populate(chatRoom, {
  //       path: 'chats',
  //       model: 'Chat',
  //       options: { sort: { createAt: 1 } },
  //       populate: { path: 'sender', select: 'nickname' },
  //     })
  //   } else return null
  // }

  // async saveMessagetoChatRoom(
  //   sender: string,
  //   message: string,
  //   chatRoomId: string,
  //   isReceiverOnline: boolean,
  // ): Promise<Chat> {
  //   const newChat = await this.chatModel.create({ sender, message })
  //   await this.chatRoomModel.findByIdAndUpdate(chatRoomId, {
  //     $push: { chats: newChat._id },
  //     isRead: isReceiverOnline,
  //   })
  //   return newChat
  // }

  async updateChatRoomIsRead(chatRoomId: string, isRead: boolean): Promise<void> {
  await this.chatRoomModel.findByIdAndUpdate(chatRoomId, { isRead });
}

  async setNewNotification(userId: string) {
    await this.userModel.findOneAndUpdate(
      { nickname: userId },
      { $set: { newNotification: true } },
    )
  }

  async getFriendIds(userId: string) {
    return await this.userModel.findOne({ nickname: userId }).lean().exec()
  }

  async changeNewMessage(receiverNickname: string, userNickname: string) {
    try{
      const user = await this.userModel.findOne({nickname : receiverNickname});

      const friendToUpdateIndex = user.friends.findIndex(friend => friend.friend == userNickname);
  
      user.friends[friendToUpdateIndex].newMessage = true;
      await user.save();
    } catch (error) {
      throw error;
    }
  }
  async changeReadMessage(receiverNickname: string, userNickname: string) {
    try{
      const user = await this.userModel.findOne({nickname : userNickname});

      const friendToUpdateIndex = user.friends.findIndex(friend => friend.friend == receiverNickname);
  
      user.friends[friendToUpdateIndex].newMessage = false;
      await user.save();
    } catch (error) {
      throw error;
    }
  }

  // // 5분마다 채팅 기록을 DB에 저장하는 스케줄러 함수
  // async saveChatHistoryToDatabase(chatRoomId: string, messages: Chat[]){
  //   try{
  //     // 1. chatRoomId를 ObjectId로 변환
  //     const chatRoomIdObj = new Types.ObjectId(chatRoomId);

  //     // 2. Chat 객체 배열을 바로 사용
  //     messages.forEach(chat => {
  //       chat.chatRoomId === chatRoomIdObj
  //     })
  //     console.log("메세지 입니다---------------------", messages);
  //     await this.chatModel.insertMany(messages)

  //   } catch (error){
  //     console.error('채팅 기록 저장 실패:', error)
  //   }
  // }
  async saveChatHistoryToMongo(chatRoomId: Types.ObjectId, chats: Chat[]): Promise<void> {
    try {
      const chatRoom = await this.chatRoomModel.findById(chatRoomId);
  
      if (!chatRoom) {
        throw new Error(`ChatRoom not found with ID: ${chatRoomId}`);
      }
  
      // 1. Chat 모델 인스턴스 생성 및 저장
      const chatInstances = chats.map(chatData => new this.chatModel(chatData)); 
      const savedChats = await this.chatModel.insertMany(chatInstances);
  
      // 3. 저장된 채팅 메시지의 ObjectId 가져오기
      const savedChatIds = savedChats.map(chat => chat._id);
  
      // 4. ChatRoom에 채팅 메시지 ID 추가 및 저장
      chatRoom.chats.push(...savedChatIds);
      await chatRoom.save();
    } catch (error) {
      console.error('Error saving chat history to MongoDB:', error);
      throw error;
    }
  }
  
  

  // Redis List에서 채팅 기록을 가져와 Chat 객체 배열로 반환합
  async getChatHistoryFromRedis(chatRoomId: string): Promise<Chat[]> {
    const messages = await this.redisClient.lrange(`chatHistory:${chatRoomId}`, 0, -1);
    return messages?.map(message => JSON.parse(message) as Chat);
  }
  
  // 기존의 데이터베이스 조회 로직을 그대로 사용
  async getChatHistoryFromDatabase(chatRoomId: string){
    const chatRoomIdObj = new Types.ObjectId(chatRoomId);
    const chatRoom = await this.chatRoomModel
      .findByIdAndUpdate(chatRoomIdObj, { $set: { isRead: true } }, { new: true })
      .lean()
      .exec();
  
    if (chatRoom) {
      return await this.chatRoomModel.populate(chatRoom, {
        path: 'chats',
        model: 'Chat',
        options: { sort: { createdAt: 1 } }, // createdAt 필드명 확인
        populate: { path: 'sender', select: 'nickname' },
      }) // 타입 단언 추가
    } else {
      return null;
    }
  }
  // 채팅 기록을 Redis List에 저장
  async saveChatHistoryToRedis(chatRoomId: string, messages: Chat[]): Promise<void> {
    await this.redisClient.rpush(`chatHistory:${chatRoomId}`, JSON.stringify(messages)); // 빈 배열도 저장
  }
}
