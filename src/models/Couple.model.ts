import mongoose, { Schema, Document, Types } from 'mongoose';

export interface IOnboardingAnswer {
  questionId: string;
  selectedOptionIds: string[];
}

export interface ICouple extends Document {
  partner1: Types.ObjectId;
  partner2?: Types.ObjectId;
  partnerInviteCode?: string;
  profileName?: string;
  bio?: string;
  avatarUrl?: string;
  location?: {
    city?: string;
    country?: string;
  };
  answers: IOnboardingAnswer[];
  isProfileComplete: boolean;
  preferences: {
    meetingFrequency?: string; // e.g. 'once-month'
    socialVibes?: string[];
    activities?: string[];
    avoidances?: string[];
    matchCriteria?: string[];
  };
  createdAt: Date;
  updatedAt: Date;
}

const CoupleSchema = new Schema<ICouple>(
  {
    partner1: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    partner2: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    partnerInviteCode: { type: String, unique: true, sparse: true },
    profileName: { type: String, trim: true },
    bio: { type: String, trim: true, maxlength: 500 },
    avatarUrl: { type: String },
    location: {
      city: { type: String },
      country: { type: String },
    },
    answers: [
      {
        questionId: { type: String, required: true },
        selectedOptionIds: [{ type: String }],
      },
    ],
    isProfileComplete: { type: Boolean, default: false },
    preferences: {
      meetingFrequency: { type: String },
      socialVibes: [{ type: String }],
      activities: [{ type: String }],
      avoidances: [{ type: String }],
      matchCriteria: [{ type: String }],
    },
  },
  { timestamps: true },
);

export const Couple = mongoose.model<ICouple>('Couple', CoupleSchema);
