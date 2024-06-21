import { IsString } from 'class-validator'
import {Types} from 'mongoose';
export class ReqGetUserDto {
  @IsString()
  _id: Types.ObjectId
}
