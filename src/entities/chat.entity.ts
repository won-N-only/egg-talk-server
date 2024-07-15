// import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose'
// import { Types } from 'mongoose'


// export interface Chat {
//   _id?: Types.ObjectId; // 선택적 속성
//   sender: string;
//   message: string;
//   chatRoomId: Types.ObjectId;
//   timestamp: Date; // Date 타입으로 지정
// }

// export interface ChatWithMetadata extends Chat {
//   messageId: number;
// }

// @Schema({ timestamps: true })
// export class Chat {
//   @Prop({ type: String, required: true })
//   sender: string

//   @Prop({ type: String, required: true })
//   message: string

//   @Prop({ type: Types.ObjectId, ref: 'ChatRoom', required: true })
//   chatRoomId: Types.ObjectId;

//   @Prop({ type: Date }) // 또는 Date
//   timestamp: Date; // 또는 Date
// }

// export const ChatSchema = SchemaFactory.createForClass(Chat)
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Types, Document } from 'mongoose';

export interface Chat {
  _id?: Types.ObjectId; // 선택적 속성
  sender: string;
  message: string;
  chatRoomId: Types.ObjectId;
  timestamp: Date; // Date 타입으로 지정
}

export interface ChatWithMetadata extends Chat {
  messageId: number;
}

@Schema({ timestamps: true })
export class Chat extends Document {
  @Prop({ type: String, required: true })
  sender: string;

  @Prop({ type: String, required: true })
  message: string;

  @Prop({ type: Types.ObjectId, ref: 'ChatRoom', required: true })
  chatRoomId: Types.ObjectId;

  @Prop({ type: Date }) // 또는 Date
  timestamp: Date; // 또는 Date
}

export const ChatSchema = SchemaFactory.createForClass(Chat);

export interface ChatRoom extends Document {
  _id: Types.ObjectId;
  chats: Types.ObjectId[] | Chat[];
}

