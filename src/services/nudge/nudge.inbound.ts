import { prisma } from '../../lib/prisma';
import { logger } from '../../utils/logger';
import { START_WORDS, STOP_WORDS, NUDGE_STATUS_MATCH_HOURS } from '../../constants/nudge';
import { maskPhone } from '../abuseGuard';
import { getWhatsAppProvider } from './channels/whatsapp.channel';
import { handleProviderStatus } from './nudge.engine';
import { setOptInByPhone } from './nudge.preferences';
import { executeQuickReply } from './nudge.actions';

/**
 * Inbound side of the WhatsApp channel (WATI webhook events).
 *
 *   status events   templateMessageSent / sentMessageDELIVERED / sentMessageREAD /
 *                   templateMessageFailed → the delivery funnel
 *   messages        STOP / START keywords → consent; a template's quick-reply
 *                   button title → an action (send love back, mark seen)
 *
 * WATI field names vary a little by event type and plan; every read below is
 * defensive and the raw eventType is logged at debug level so a new shape
 * shows up in the logs instead of silently doing nothing.
 */

// Master Reference §11.7 — consent confirmations (session replies, free-form).
export const STOP_REPLY = "You won't get WhatsApp updates from Sawa any more. Reply START any time to turn them back on.";
export const START_REPLY = 'WhatsApp updates from Sawa are back on.';

export type InboundKind = 'stop' | 'start' | null;

/** Whole-message keyword match, case/space/punctuation insensitive. */
export function classifyInboundText(text: string | null | undefined): InboundKind {
  const norm = (text || '')
    .toLowerCase()
    .replace(/[!.,।]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!norm) return null;
  if (STOP_WORDS.has(norm)) return 'stop';
  if (START_WORDS.has(norm)) return 'start';
  return null;
}

const str = (v: unknown): string => (typeof v === 'string' ? v : '');

/** The human text of an inbound event: plain text, or the title of a tapped button/list item. */
export function inboundText(ev: any): string {
  return (
    str(ev?.buttonReply?.text) ||
    str(ev?.interactiveButtonReply?.title) ||
    str(ev?.listReply?.title) ||
    str(ev?.text) ||
    ''
  ).trim();
}

export async function handleWatiEvent(ev: unknown): Promise<void> {
  const e = (ev ?? {}) as Record<string, any>;
  const type = str(e.eventType ?? e.type).toLowerCase();
  const waId = str(e.waId ?? e.whatsappNumber ?? e.from).replace(/\D/g, '') || null;
  const msgId = str(e.whatsappMessageId) || str(e.id) || null;
  logger.debug(`[Nudge] WATI event ${type || '?'} from ${waId ? maskPhone(`+${waId}`) : '?'}`);

  if (type.includes('delivered')) {
    await handleProviderStatus({ providerMessageId: msgId, phoneDigits: waId, status: 'delivered' });
    return;
  }
  if (type.includes('read')) {
    await handleProviderStatus({ providerMessageId: msgId, phoneDigits: waId, status: 'read' });
    return;
  }
  if (type.includes('failed')) {
    const reason = str(e.failedReason ?? e.reason ?? e.statusString) || 'provider_failed';
    await handleProviderStatus({ providerMessageId: msgId, phoneDigits: waId, status: 'failed', error: reason.slice(0, 200) });
    return;
  }
  if (type === 'templatemessagesent' || type === 'sentmessage') {
    await handleProviderStatus({ providerMessageId: msgId, phoneDigits: waId, status: 'sent' });
    return;
  }

  // Inbound human message. `owner: true` marks our own outbound echoes.
  const inbound = type === 'message' || type === 'newcontactmessagereceived' || type.includes('replied');
  if (!inbound || e.owner === true || !waId) return;

  const text = inboundText(e);
  const kind = classifyInboundText(text);
  const provider = getWhatsAppProvider();

  if (kind === 'stop') {
    await setOptInByPhone(`+${waId}`, false, 'whatsapp_stop');
    if (provider) void provider.sendText(waId, STOP_REPLY);
    return;
  }
  if (kind === 'start') {
    await setOptInByPhone(`+${waId}`, true, 'whatsapp_stop');
    if (provider) void provider.sendText(waId, START_REPLY);
    return;
  }

  // Quick reply: match the button title against the newest template we sent them.
  if (!text) return;
  const since = new Date(Date.now() - NUDGE_STATUS_MATCH_HOURS * 3600_000);
  const delivery = await prisma.nudgeDelivery.findFirst({
    where: { phone: waId, channel: 'whatsapp', sentAt: { gte: since }, status: { in: ['sent', 'delivered', 'read'] } },
    orderBy: { sentAt: 'desc' },
    select: { id: true, family: true, locale: true, coupleId: true, recipientUserId: true, templateKey: true },
  });
  if (!delivery) return;
  const template = await prisma.nudgeTemplate.findFirst({
    where: { family: delivery.family, providerName: delivery.templateKey ?? undefined },
    select: { quickReplies: true },
  });
  const replies = (template?.quickReplies as Record<string, string> | null) ?? {};
  const action = Object.entries(replies).find(([title]) => title.trim().toLowerCase() === text.toLowerCase())?.[1];
  if (!action) return;
  await executeQuickReply(delivery, action);
}
