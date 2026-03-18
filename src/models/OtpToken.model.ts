import mongoose, { Schema, Document } from 'mongoose';

export interface IOtpToken extends Document {
  phone: string;
  entityId: string;       // shared couple entity ID
  otpCode: string;        // dummy: stored plain (no SMS service yet)
  expiresAt: Date;
  attempts: number;
  createdAt: Date;
}

const OtpTokenSchema = new Schema<IOtpToken>(
  {
    phone: { type: String, required: true, index: true },
    entityId: { type: String, required: true },
    otpCode: { type: String, required: true },
    expiresAt: { type: Date, required: true },
    attempts: { type: Number, default: 0 },
  },
  {
    timestamps: { createdAt: true, updatedAt: false },
  },
);

// TTL index — MongoDB auto-deletes after expiry
OtpTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
// Clean up old tokens for the same phone when new ones are issued
OtpTokenSchema.index({ phone: 1, entityId: 1 });

export const OtpToken = mongoose.model<IOtpToken>('OtpToken', OtpTokenSchema);
