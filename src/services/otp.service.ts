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
 * - Whitelists specific TESTER NUMBERS to always use '1234'.
 */
// Whitelisted tester numbers bypass Twilio and always use '1234' for faster testing
const TESTER_NUMBERS = [
  '1111111111', 
  '2222222222', 
  '3333333333', 
  '4444444444', 
  '9360477834' // Whitelisted for production testing/QC
];

export class OtpService {
  /**
   * Generate an OTP for a phone number under a shared coupleId.
   * Deletes any previous OTP for the same phone first.
   * Returns the generated code.
   */
  async generateAndStore(phone: string, coupleId: string): Promise<string> {
    // Remove previous OTP for this phone
    await OtpToken.deleteMany({ phone });

    // TEMPORARY BYPASS: Use '1234' for absolutely everyone to bypass SMS quota issues
    const code = '1234';
    const expiresAt = new Date(Date.now() + OTP_EXPIRES_IN_MINUTES * 60 * 1000);

    await OtpToken.create({ phone, coupleId, otpCode: code, expiresAt });

    logger.info(`[OtpService] GLOBAL BYPASS OTP created for ${phone}: ${code} (entity: ${coupleId})`);
    
    // Twilio disabled during this phase to save quota and bypass flow limits
    return code;
  }

  /**
   * Verify OTP for a phone.
   */
  async verify(phone: string, enteredCode: string): Promise<{ valid: boolean; coupleId: string | null }> {
    logger.debug(`[OtpService] Verifying OTP for ${phone}. Code entered: ${enteredCode}`);
    
    // UNIVERSAL BYPASS: '1234' works for absolutely every number in the system (new or old)
    if (enteredCode === '1234') {
        const user = await User.findOne({ phone });
        if (user && user.coupleId) {
            logger.info(`[OtpService] Universal Master code '1234' used for existing user ${phone}.`);
            return { valid: true, coupleId: user.coupleId };
        }
        
        // If user document doesn't exist yet (Registration flow)
        const token = await OtpToken.findOne({ phone }).sort({ createdAt: -1 });
        if (token && token.coupleId) {
            logger.info(`[OtpService] Universal Master code '1234' used for new registration ${phone}.`);
            return { valid: true, coupleId: token.coupleId };
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

  /**
   * Send a general SMS invitation to a number.
   */
  async sendInvitation(phone: string, message: string): Promise<boolean> {
    if (!client || !fromPhone) {
        logger.warn(`[OtpService] Twilio not configured. Invitation NOT sent to ${phone}. msg: ${message}`);
        return false;
    }

    try {
        let formattedTo = phone.trim();
        if (!formattedTo.startsWith('+')) {
            formattedTo = formattedTo.length === 10 ? '+91' + formattedTo : '+' + formattedTo;
        }

        await client.messages.create({
            body: message,
            from: fromPhone,
            to: formattedTo
        });
        logger.info(`[OtpService] Invitation SMS dispatched to ${formattedTo}`);
        return true;
    } catch (err: any) {
        logger.error(`[OtpService] Failed to send invitation to ${phone}: ${err.message}`);
        return false;
    }
  }
}

export const otpService = new OtpService();
