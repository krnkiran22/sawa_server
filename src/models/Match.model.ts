import mongoose, { Schema, Document, Types } from 'mongoose';

export type MatchStatus = 'pending' | 'accepted' | 'rejected';

export interface IMatch extends Document {
  couple1: Types.ObjectId;
  couple2: Types.ObjectId;
  status: MatchStatus;
  matchScore: number;
  initiatedBy: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const MatchSchema = new Schema<IMatch>(
  {
    couple1: { type: Schema.Types.ObjectId, ref: 'Couple', required: true },
    couple2: { type: Schema.Types.ObjectId, ref: 'Couple', required: true },
    status: {
      type: String,
      enum: ['pending', 'accepted', 'rejected'],
      default: 'pending',
    },
    matchScore: { type: Number, default: 0, min: 0, max: 100 },
    initiatedBy: { type: Schema.Types.ObjectId, ref: 'Couple', required: true },
  },
  { timestamps: true },
);

// Ensure a couple-pair can only have one match record
MatchSchema.index({ couple1: 1, couple2: 1 }, { unique: true });

export const Match = mongoose.model<IMatch>('Match', MatchSchema);
