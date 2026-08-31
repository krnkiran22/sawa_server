import { env } from '../../../config/env';
import { logger } from '../../../utils/logger';
import type { SendResult, SendTemplateInput, WhatsAppProvider } from '../nudge.types';

/**
 * WATI (WhatsApp Business API BSP) provider. Arfam's verified business number
 * lives there (decision 2026-08-31), so this is the production sender.
 *
 * Endpoints (WATI public API, tenant-scoped base URL like
 * https://live-mt-server.wati.io/<tenantId>):
 *   POST /api/v1/sendTemplateMessage?whatsappNumber=<digits>
 *        { template_name, broadcast_name, parameters: [{ name, value }] }
 *   POST /api/v1/sendSessionMessage/<digits>?messageText=<text>
 *
 * Auth is a bearer token from the WATI dashboard (some dashboards hand it out
 * already prefixed "Bearer "; both forms are accepted). Everything here has a
 * hard timeout and never throws: the worker records the failure on the
 * delivery row and moves on.
 *
 * Message-id note: WATI's send response does not reliably carry the WhatsApp
 * message id; when it does we store it, otherwise delivery/read callbacks are
 * matched to the latest send to that phone (nudge.engine handleProviderStatus).
 */

const TIMEOUT_MS = 10_000;

const base = (): string => (env.WATI_API_URL || '').replace(/\/+$/, '');

const bearer = (): string => {
  const raw = (env.WATI_API_TOKEN || '').trim();
  return raw.toLowerCase().startsWith('bearer ') ? raw : `Bearer ${raw}`;
};

async function post(url: string, body?: unknown): Promise<{ ok: boolean; status: number; json: any }> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: bearer(),
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: ctrl.signal,
    });
    let json: any = null;
    try {
      json = await res.json();
    } catch {
      json = null;
    }
    return { ok: res.ok, status: res.status, json };
  } finally {
    clearTimeout(timer);
  }
}

const pickMessageId = (json: any): string | undefined => {
  const candidates = [
    json?.receivers?.[0]?.whatsappMessageId,
    json?.whatsappMessageId,
    json?.model?.whatsappMessageId,
    json?.message?.whatsappMessageId,
    json?.localMessageId,
    json?.model?.localMessageId,
  ];
  const id = candidates.find((c) => typeof c === 'string' && c.length > 0);
  return id as string | undefined;
};

export const watiProvider: WhatsAppProvider = {
  name: 'wati',

  async sendTemplate(input: SendTemplateInput): Promise<SendResult> {
    if (!base() || !env.WATI_API_TOKEN) return { ok: false, error: 'wati_not_configured' };
    const url = `${base()}/api/v1/sendTemplateMessage?whatsappNumber=${encodeURIComponent(input.toDigits)}`;
    const body = {
      template_name: input.templateName,
      broadcast_name: input.label,
      parameters: input.variables.map((value, i) => ({ name: String(i + 1), value })),
    };
    try {
      const { ok, status, json } = await post(url, body);
      if (!ok || json?.result === false) {
        const info = typeof json?.info === 'string' ? json.info : typeof json?.message === 'string' ? json.message : `http_${status}`;
        return { ok: false, error: info.slice(0, 200) };
      }
      if (json?.validWhatsAppNumber === false) return { ok: false, error: 'not_on_whatsapp' };
      return { ok: true, providerMessageId: pickMessageId(json) };
    } catch (err: any) {
      const msg = err?.name === 'AbortError' ? 'timeout' : String(err?.message ?? err);
      logger.warn(`[WATI] sendTemplate ${input.templateName} failed: ${msg}`);
      return { ok: false, error: msg.slice(0, 200) };
    }
  },

  async sendText(toDigits: string, text: string): Promise<SendResult> {
    if (!base() || !env.WATI_API_TOKEN) return { ok: false, error: 'wati_not_configured' };
    const url = `${base()}/api/v1/sendSessionMessage/${encodeURIComponent(toDigits)}?messageText=${encodeURIComponent(text)}`;
    try {
      const { ok, status, json } = await post(url);
      if (!ok || json?.result === false) {
        const info = typeof json?.info === 'string' ? json.info : `http_${status}`;
        return { ok: false, error: info.slice(0, 200) };
      }
      return { ok: true, providerMessageId: pickMessageId(json) };
    } catch (err: any) {
      const msg = err?.name === 'AbortError' ? 'timeout' : String(err?.message ?? err);
      logger.warn(`[WATI] sendText failed: ${msg}`);
      return { ok: false, error: msg.slice(0, 200) };
    }
  },
};
