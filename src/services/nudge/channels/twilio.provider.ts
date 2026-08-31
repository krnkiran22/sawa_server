import twilio from 'twilio';
import { env } from '../../../config/env';
import { logger } from '../../../utils/logger';
import type { SendResult, SendTemplateInput, WhatsAppProvider } from '../nudge.types';

/**
 * Twilio WhatsApp provider. The pre-2026-08-31 transport (services/
 * whatsapp.service.ts, now retired) ported onto the channel interface so the
 * engine can switch BSPs with one env var. Kept as the fallback/sandbox path;
 * production is WATI (Arfam's verified number lives there).
 *
 * Twilio's Content API addresses a template by SID, not by name. The template
 * row's `providerName` therefore holds the HX... content SID when this
 * provider is active. Variables travel as {"1": ..., "2": ...}.
 */

const ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID;
const AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN;

let client: ReturnType<typeof twilio> | null = null;
const getClient = () => {
  if (client) return client;
  if (!ACCOUNT_SID || !AUTH_TOKEN || !env.TWILIO_WHATSAPP_FROM) return null;
  client = twilio(ACCOUNT_SID, AUTH_TOKEN);
  return client;
};

export const twilioProvider: WhatsAppProvider = {
  name: 'twilio',

  async sendTemplate(input: SendTemplateInput): Promise<SendResult> {
    const c = getClient();
    if (!c) return { ok: false, error: 'twilio_not_configured' };
    try {
      const vars: Record<string, string> = {};
      input.variables.forEach((v, i) => { vars[String(i + 1)] = v; });
      const msg = await c.messages.create({
        from: env.TWILIO_WHATSAPP_FROM!,
        to: `whatsapp:+${input.toDigits}`,
        contentSid: input.templateName,
        contentVariables: JSON.stringify(vars),
      });
      return { ok: true, providerMessageId: msg.sid };
    } catch (err: any) {
      logger.warn(`[TwilioWA] sendTemplate failed: ${err?.message ?? err}`);
      return { ok: false, error: String(err?.message ?? err).slice(0, 200) };
    }
  },

  async sendText(toDigits: string, text: string): Promise<SendResult> {
    const c = getClient();
    if (!c) return { ok: false, error: 'twilio_not_configured' };
    try {
      const msg = await c.messages.create({
        from: env.TWILIO_WHATSAPP_FROM!,
        to: `whatsapp:+${toDigits}`,
        body: text.slice(0, 1500),
      });
      return { ok: true, providerMessageId: msg.sid };
    } catch (err: any) {
      logger.warn(`[TwilioWA] sendText failed: ${err?.message ?? err}`);
      return { ok: false, error: String(err?.message ?? err).slice(0, 200) };
    }
  },
};
