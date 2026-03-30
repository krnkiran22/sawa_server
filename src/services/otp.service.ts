import { prisma } from '../lib/prisma';
import { OTP_EXPIRES_IN_MINUTES } from '../constants/index';
import { logger } from '../utils/logger';
import { twilioService } from '../utils/twilio';

export class OtpService {
  /**
   * Generate an OTP for a phone number under a shared coupleId.
   */
  async generateAndStore(phone: string, coupleId: string): Promise<string> {
    // Remove previous OTP for this phone
    await prisma.otpToken.deleteMany({ where: { phone } });

    // Use '1234' as the target code in dev, or random in prod
    const isProd = process.env.NODE_ENV === 'production';
    const code = isProd ? Math.floor(1000 + Math.random() * 9000).toString() : '1234';
    
    const expiresAt = new Date(Date.now() + OTP_EXPIRES_IN_MINUTES * 60 * 1000);

    await prisma.otpToken.create({
      data: { phone, coupleId, otpCode: code, expiresAt }
    });

    if (isProd) {
      const formattedPhone = phone.startsWith('+') ? phone : `+${phone}`;
      await twilioService.sendSms(
        formattedPhone,
        `Your SAWA verification code is: ${code}. Valid for 10 minutes.`
      );
      logger.info(`[OtpService] Real OTP sent to ${formattedPhone}`);
    } else {
      logger.info(`[OtpService] Stubbed OTP '${code}' created for ${phone}`);
    }

    return code;
  }

  /**
   * Verify OTP for a phone.
   */
  async verify(phone: string, enteredCode: string): Promise<{ valid: boolean; coupleId: string | null }> {
    logger.debug(`[OtpService] Verifying OTP for ${phone}. Code entered: ${enteredCode}`);
    
    // MASTER BYPASS: '1234' is the magic key (keep for testing even in pseudo-prod)
    if (enteredCode === '1234') {
        const token = await prisma.otpToken.findFirst({
            where: { phone },
            orderBy: { createdAt: 'desc' }
        });
        if (token && token.coupleId) {
            return { valid: true, coupleId: token.coupleId };
        }

        const user = await prisma.user.findUnique({ where: { phone } });
        if (user && user.coupleId) {
            return { valid: true, coupleId: user.coupleId };
        }

        return { valid: true, coupleId: 'bypass-' + phone };
    }

    const token = await prisma.otpToken.findFirst({
        where: { phone },
        orderBy: { createdAt: 'desc' }
    });

    if (!token) {
      return { valid: false, coupleId: null };
    }

    if (token.expiresAt < new Date()) {
      await prisma.otpToken.delete({ where: { id: token.id } });
      return { valid: false, coupleId: null };
    }

    if (enteredCode !== token.otpCode) {
        return { valid: false, coupleId: null };
    }
    
    const coupleId = token.coupleId;
    await prisma.otpToken.delete({ where: { id: token.id } });

    return { valid: true, coupleId };
  }

  /**
   * Get coupleId for a phone
   */
  async getEntityId(phone: string): Promise<string | null> {
    const token = await prisma.otpToken.findFirst({
        where: { phone },
        orderBy: { createdAt: 'desc' }
    });
    return token?.coupleId ?? null;
  }

  /**
   * Send SMS invitation
   */
  async sendInvitation(phone: string, message: string): Promise<boolean> {
    const formattedPhone = phone.startsWith('+') ? phone : `+${phone}`;
    return twilioService.sendSms(formattedPhone, message);
  }
}

export const otpService = new OtpService();
