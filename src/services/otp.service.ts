import { OtpToken } from '../models/OtpToken.model';
import { OTP_LENGTH, OTP_EXPIRES_IN_MINUTES } from '../constants/index';
import { logger } from '../utils/logger';
import { User } from '../models/User.model';
import twilio from 'twilio';

// Twilio Config
const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;
const fromPhone = process.env.TWILIO_PHONE_NUMBER;

const client = (accountSid && authToken) ? twilio(accountSid, authToken) : null;

/**
 * OTP Service — TWILIO INTEGRATED
 * ─────────────────────────
 * - Generates real 4-digit codes.
 * - Sends SMS via Twilio if account credentials are provided.
 * - Falls back to DUMMY '1234' only if Twilio is not configured.
 */
export class OtpService {
  /**
   * Generate an OTP for a phone number under a shared coupleId.
   * Deletes any previous OTP for the same phone first.
   * Returns the generated code.
   */
  async generateAndStore(phone: string, coupleId: string): Promise<string> {
    // Remove previous OTP for this phone
    await OtpToken.deleteMany({ phone });

    // Generate real 4-digit random code (or keep 1234 if no twilio)
    let code = '1234';
    if (client) {
      code = Math.floor(1000 + Math.random() * 9000).toString();
    }

    const expiresAt = new Date(Date.now() + OTP_EXPIRES_IN_MINUTES * 60 * 1000);

    await OtpToken.create({ phone, coupleId, otpCode: code, expiresAt });

    logger.info(`[OtpService] OTP generated for ${phone} (entity: ${coupleId})`);
    
    // ─── SEND SMS VIA TWILIO ────────────────────
    if (client && fromPhone) {
        try {
            logger.info(`[OtpService] Sending REAL SMS to ${phone} via Twilio...`);
            await client.messages.create({
                body: `SAWA: Your verification code is ${code}. Please enter this code in the app to continue.`,
                from: fromPhone,
                to: phone
            });
            logger.info(`[OtpService] SMS successfully dispatched to ${phone}`);
        } catch (err: any) {
            logger.error(`[OtpService] FAILED to send SMS to ${phone}: ${err.message}`);
            // Non-blocking error, we still want the user to see the code if in dev
        }
    } else {
        logger.warn(`[OtpService] Twilio not configured. NO SMS SENT. Fallback code is: ${code}`);
    }

    // In dev, log the code so it can be used without SMS
    if (process.env.NODE_ENV !== 'production') {
      logger.info(`[OtpService] DEV LOG CODE for ${phone}: ${code}`);
    }

    return code;
  }

  /**
   * Verify OTP for a phone.
   */
  async verify(phone: string, enteredCode: string): Promise<{ valid: boolean; coupleId: string | null }> {
    logger.debug(`[OtpService] Verifying OTP for ${phone}. Code entered: ${enteredCode}`);
    
    // "Master" Dummy Code '1234' for local testing (even if Twilio is ON)
    if (process.env.NODE_ENV !== 'production' && enteredCode === '1234') {
        const user = await User.findOne({ phone });
        if (user && user.coupleId) {
            logger.info(`[OtpService] Master code '1234' used for ${phone} in DEV.`);
            return { valid: true, coupleId: user.coupleId };
        }
    }

    const token = await OtpToken.findOne({ phone }).sort({ createdAt: -1 });

    if (!token) {
      logger.warn(`[OtpService] No OTP token found in DB for ${phone}.`);
      return { valid: false, coupleId: null };
    }

    if (token.expiresAt < new Date()) {
      logger.warn(`[OtpService] OTP token expired for ${phone}`);
      await OtpToken.deleteOne({ _id: token._id });
      return { valid: false, coupleId: null };
    }

    if (enteredCode !== token.otpCode) {
        logger.info(`[OtpService] Invalid OTP code: ${enteredCode} for ${phone}`);
        return { valid: false, coupleId: null };
    }
    
    const coupleId = token.coupleId;
    await OtpToken.deleteOne({ _id: token._id });

    logger.info(`[OtpService] OTP verified successfully for ${phone}`);
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
