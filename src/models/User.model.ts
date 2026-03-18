import mongoose, { Schema, Document, Types } from 'mongoose';

export interface IUser extends Document {
  phone: string;
  coupleId: string;          // shared couple ID
  isPhoneVerified: boolean;
  refreshTokenHash?: string;
  role: 'primary' | 'partner'; // which seat in the couple
  createdAt: Date;
  updatedAt: Date;
}

const UserSchema = new Schema<IUser>(
  {
    phone: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },
    coupleId: {
      type: String,
      required: true,
      index: true,
    },
    isPhoneVerified: {
      type: Boolean,
      default: false,
    },
    refreshTokenHash: {
      type: String,
      select: false,
    },
    role: {
      type: String,
      enum: ['primary', 'partner'],
      required: true,
    },
  },
  {
    timestamps: true,
  },
);

export const User = mongoose.model<IUser>('User', UserSchema);
