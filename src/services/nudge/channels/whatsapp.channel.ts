import { env } from '../../../config/env';
import { logger } from '../../../utils/logger';
import type { WhatsAppProvider } from '../nudge.types';
import { watiProvider } from './wati.provider';
import { twilioProvider } from './twilio.provider';

/**
 * Channel selector. One place decides whether WhatsApp is on and which BSP
 * carries it, so the engine, the webhook and the admin test-send all agree.
 *
 *   WHATSAPP_NOTIFICATIONS_ENABLED=true   master switch
 *   WHATSAPP_PROVIDER=wati|twilio|none    who sends
 */

let warned = false;

export function getWhatsAppProvider(): WhatsAppProvider | null {
  if (!env.WHATSAPP_NOTIFICATIONS_ENABLED) return null;
  switch (env.WHATSAPP_PROVIDER) {
    case 'wati':
      if (env.WATI_API_URL && env.WATI_API_TOKEN) return watiProvider;
      break;
    case 'twilio':
      if (process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && env.TWILIO_WHATSAPP_FROM) {
        return twilioProvider;
      }
      break;
    default:
      break;
  }
  if (!warned) {
    warned = true;
    logger.warn(
      `[WhatsApp] WHATSAPP_NOTIFICATIONS_ENABLED=true but provider '${env.WHATSAPP_PROVIDER}' is not fully configured. ` +
        'WhatsApp sends are recorded as suppressed (disabled) until it is.',
    );
  }
  return null;
}

export const isWhatsAppEnabled = (): boolean => getWhatsAppProvider() !== null;

/** Stored phones are '+91…', '91…' or 10-digit Indian numbers; providers want bare E.164 digits. */
export function toWhatsAppDigits(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, '');
  if (!digits) return null;
  if (phone.trim().startsWith('+')) return digits;
  if (digits.length === 10) return `91${digits}`;
  return digits;
}
