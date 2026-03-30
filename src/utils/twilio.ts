import { env } from '../config/env';
import twilio from 'twilio';
import { logger } from './logger';

class TwilioService {
  private client: twilio.Twilio | null = null;

  constructor() {
    if (env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN) {
      this.client = twilio(env.TWILIO_ACCOUNT_SID, env.TWILIO_AUTH_TOKEN);
      logger.info('🚀 [TwilioService] Client initialized');
    } else {
      logger.warn('⚠️ [TwilioService] Credentials missing. SMS will be stubbed.');
    }
  }

  async sendSms(to: string, body: string): Promise<boolean> {
    if (!this.client || !env.TWILIO_PHONE_NUMBER) {
      logger.info(`[TwilioService] STUBBED SMS to ${to}: "${body}"`);
      return true;
    }

    try {
      // Ensure phone number has + prefix for Twilio
      const formattedTo = to.startsWith('+') ? to : `+${to}`;
      
      await this.client.messages.create({
        body,
        from: env.TWILIO_PHONE_NUMBER,
        to: formattedTo,
      });

      logger.info(`✅ [TwilioService] SMS sent to ${formattedTo}`);
      return true;
    } catch (error) {
      logger.error(`❌ [TwilioService] Failed to send SMS to ${to}:`, error);
      return false;
    }
  }
}

export const twilioService = new TwilioService();
