import mongoose, { Schema, Document, Types } from 'mongoose';

export interface ICommunity extends Document {
  name: string;
  description?: string;
  coverImageUrl?: string;
  members: Types.ObjectId[];
  admins: Types.ObjectId[];
  isPrivate: boolean;
  maxMembers: number;
  tags: string[];
  createdBy: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const CommunitySchema = new Schema<ICommunity>(
  {
    name: { type: String, required: true, trim: true, maxlength: 100 },
    description: { type: String, trim: true, maxlength: 500 },
    coverImageUrl: { type: String },
    members: [{ type: Schema.Types.ObjectId, ref: 'Couple' }],
    admins: [{ type: Schema.Types.ObjectId, ref: 'Couple' }],
    isPrivate: { type: Boolean, default: false },
    maxMembers: { type: Number, default: 50 },
    tags: [{ type: String, lowercase: true, trim: true }],
    createdBy: { type: Schema.Types.ObjectId, ref: 'Couple', required: true },
  },
  { timestamps: true },
);

CommunitySchema.index({ tags: 1 });

export const Community = mongoose.model<ICommunity>('Community', CommunitySchema);
