import mongoose, { Schema, Document } from 'mongoose';

export interface IOtpToken extends Document {
  phone: string;
  otpHash: string;
  expiresAt: Date;
  attempts: number;
  createdAt: Date;
}

const OtpTokenSchema = new Schema<IOtpToken>(
  {
    phone: { type: String, required: true, index: true },
    otpHash: { type: String, required: true, select: false },
    expiresAt: { type: Date, required: true },
    attempts: { type: Number, default: 0 },
  },
  {
    timestamps: { createdAt: true, updatedAt: false },
  },
);

// TTL index — MongoDB auto-deletes expired documents
OtpTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const OtpToken = mongoose.model<IOtpToken>('OtpToken', OtpTokenSchema);
