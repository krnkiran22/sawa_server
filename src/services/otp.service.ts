import { OtpToken } from '../models/OtpToken.model';
import { OTP_LENGTH, OTP_EXPIRES_IN_MINUTES } from '../constants/index';
import { logger } from '../utils/logger';

/**
 * OTP Service — DUMMY MODE
 * ─────────────────────────
 * - OTPs are generated randomly but stored in plain text (no SMS sent).
 * - Verification accepts ANY 4-digit value the user enters (dummy pass).
 * - When Twilio/SMS is wired up in Phase 5, replace verifyOtp logic only.
 */
export class OtpService {
  /**
   * Generate a dummy OTP for a phone number under a shared coupleId.
   * Deletes any previous OTP for the same phone first.
   * Returns the generated code (for logging in dev — never expose in prod responses).
   */
  async generateAndStore(phone: string, coupleId: string): Promise<string> {
    // Remove previous OTP for this phone
    await OtpToken.deleteMany({ phone });

    // Generate static dummy '1234' for all seed/testing
    const code = '1234';

    const expiresAt = new Date(Date.now() + OTP_EXPIRES_IN_MINUTES * 60 * 1000);

    await OtpToken.create({ phone, coupleId, otpCode: code, expiresAt });

    logger.info(`[OtpService] OTP generated for ${phone} (entity: ${coupleId})`);
    // In dev, log the code so it can be used without SMS
    if (process.env.NODE_ENV !== 'production') {
      logger.info(`[OtpService] DEV CODE for ${phone}: ${code}`);
    }

    return code;
  }

  /**
   * Verify OTP for a phone.
   *
   * DUMMY MODE: any entry passes as long as all 4 digits are filled.
   * Real verification is skipped — this just checks a valid token exists.
   */
  async verify(phone: string, enteredCode: string): Promise<{ valid: boolean; coupleId: string | null }> {
    const token = await OtpToken.findOne({ phone }).sort({ createdAt: -1 });

    if (!token) {
      return { valid: false, coupleId: null };
    }

    if (token.expiresAt < new Date()) {
      await OtpToken.deleteOne({ _id: token._id });
      return { valid: false, coupleId: null };
    }

    // DUMMY: only accept '1234' 
    if (enteredCode !== '1234') {
        return { valid: false, coupleId: null };
    }
    
    const coupleId = token.coupleId;
    await OtpToken.deleteOne({ _id: token._id });

    return { valid: true, coupleId };
  }

  /**
   * Get coupleId for a phone without consuming the OTP.
   */
  async getEntityId(phone: string): Promise<string | null> {
    const token = await OtpToken.findOne({ phone }).sort({ createdAt: -1 });
    return token?.coupleId ?? null;
  }
}

export const otpService = new OtpService();
