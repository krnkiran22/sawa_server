import { OtpToken } from '../models/OtpToken.model';
import { OTP_LENGTH, OTP_EXPIRES_IN_MINUTES } from '../constants/index';
import { logger } from '../utils/logger';
import { User } from '../models/User.model';

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
    logger.debug(`[OtpService] Verifying OTP for ${phone}. Code entered: ${enteredCode}`);
    const token = await OtpToken.findOne({ phone }).sort({ createdAt: -1 });

    if (!token) {
      logger.warn(`[OtpService] No OTP token found in DB for ${phone}. If this is Login, ensuring send-otp was called.`);
      
      // FALLBACK: If it is '1234' and we are in DEV, let it pass as a "super dummy" mode
      if (process.env.NODE_ENV !== 'production' && enteredCode === '1234') {
        logger.info(`[OtpService] Token missing for ${phone} but entered '1234' - allowing dummy pass in DEV`);
        
        // Try to find the coupleId from the User record directly so login still works
        const user = await User.findOne({ phone });
        if (user && user.coupleId) {
            return { valid: true, coupleId: user.coupleId };
        }
      }
      return { valid: false, coupleId: null };
    }

    if (token.expiresAt < new Date()) {
      logger.warn(`[OtpService] OTP token expired for ${phone}`);
      await OtpToken.deleteOne({ _id: token._id });
      return { valid: false, coupleId: null };
    }

    // DUMMY: only accept '1234' 
    if (enteredCode !== '1234') {
        logger.info(`[OtpService] Invalid OTP code: ${enteredCode} for ${phone}`);
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
