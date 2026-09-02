import { Prisma, type NudgeStatus } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { env } from '../../config/env';
import { logger } from '../../utils/logger';
import { cacheIncrExpire } from '../../lib/cache';
import { renderNotif } from '../../i18n/notif';
import { isUserOnlineGlobal } from '../../sockets/presence';
import { normalizePhone } from '../../repositories/user.repository';
import { maskPhone } from '../abuseGuard';
import {
  ACTIVITY_INSENSITIVE_FAMILIES,
  FREEFORM_FIRST_FAMILIES,
  HARD_EXCLUDED_FAMILIES,
  NUDGE_CONVERSION_WINDOW_MIN,
  NUDGE_MAX_EVENT_ATTEMPTS,
  NUDGE_STATUS_MATCH_HOURS,
} from '../../constants/nudge';
import { decide, secondsToUtcDayEnd, utcDay, utcDayStart } from './nudge.policy';
import { getWhatsAppProvider, isWhatsAppEnabled, toWhatsAppDigits } from './channels/whatsapp.channel';
import { enabledFamilies, resolveTemplate } from './nudge.templates';
import { renderVariables } from './nudge.copy';
import { buildLinkUrl, newLinkToken, targetFor } from './nudge.links';
import { getPreferencesMany } from './nudge.preferences';
import type { CopyContext, PolicyRecipient } from './nudge.types';

/**
 * The Nudge engine: outbox → policy → deliveries → provider.
 *
 * Postgres is the durable queue. Both claim steps use FOR UPDATE SKIP LOCKED
 * so several worker processes can drain concurrently without double-sending,
 * and a crash mid-tick loses nothing (unprocessed rows are simply reclaimed;
 * rows stuck in `sending` are released after a grace period).
 */

// ─── Shared shapes ────────────────────────────────────────────────────────────

const SENTISH: NudgeStatus[] = ['queued', 'sending', 'sent', 'delivered', 'read'];

interface PushLike {
  title?: string;
  body?: string;
  data?: Record<string, unknown>;
}

export interface EnqueueInput {
  family: string;
  coupleId: string;
  recipientUserIds: string[];
  actorUserId?: string | null;
  eventId?: string | null;
  payload?: PushLike | null;
  /** Journey-supplied context (suggestion, city, step…). */
  ctxExtra?: Partial<CopyContext>;
}

const firstName = (s?: string | null): string => (s || '').trim().split(/\s+/)[0] || '';

/** Fall back to the couple's "A & B" profile name when a user row has no name. */
const displayName = (
  user: { name: string | null; role: string },
  profileName: string | null | undefined,
): string => {
  if (user.name?.trim()) return firstName(user.name);
  const parts = (profileName || '').split(/\s*&\s*/);
  return firstName(user.role === 'partner' ? parts[1] : parts[0]);
};

const parseParams = (raw: unknown): Record<string, string> => {
  if (!raw) return {};
  if (typeof raw === 'string') {
    try { return JSON.parse(raw) as Record<string, string>; } catch { return {}; }
  }
  return typeof raw === 'object' ? (raw as Record<string, string>) : {};
};

/** Build the copy context for one recipient from the moment's push payload. */
function contextFor(
  family: string,
  payload: PushLike | null | undefined,
  recipientName: string,
  partnerName: string,
  locale: string,
  extra?: Partial<CopyContext>,
): CopyContext {
  const data = payload?.data ?? {};
  const p = parseParams(data.i18nParams);
  const i18nKey = typeof data.i18nKey === 'string' ? data.i18nKey : undefined;
  const rendered = i18nKey ? renderNotif(locale, i18nKey, p) : { title: payload?.title ?? '', body: payload?.body ?? '' };
  const title = (rendered.title || payload?.title || '').trim();
  const body = (rendered.body || payload?.body || '').trim();
  return {
    name: p.name || undefined,
    g: p.g === 'f' ? 'f' : p.g === 'm' ? 'm' : undefined,
    feeling: p.feeling || (typeof data.feeling === 'string' ? data.feeling : undefined),
    note: p.note || undefined,
    game: p.game || undefined,
    profileName: typeof data.profileName === 'string' ? data.profileName : p.name || undefined,
    city: p.city || undefined,
    community: p.community || undefined,
    recipientName,
    partnerName,
    text: [title, body].filter(Boolean).join(title && body && !/[.!?]$/.test(title) ? '. ' : ' '),
    ...extra,
    ...(family === 'welcome' ? { recipientName } : {}),
  };
}

// ─── Global daily spend cap ───────────────────────────────────────────────────
// Mirrors the SMS abuse guard's last-incremented kill switch: the counter only
// moves for a send that passed every other gate. Redis-backed when available;
// per-process otherwise (single instance without Redis, see ecosystem.config).
const localGlobal = new Map<string, number>();

async function globalCount(): Promise<number> {
  const key = `nudge:wa:global:${utcDay()}`;
  const r = await cacheIncrExpire(key, secondsToUtcDayEnd());
  if (r) return r.count;
  const n = (localGlobal.get(key) ?? 0) + 1;
  localGlobal.set(key, n);
  if (localGlobal.size > 3) localGlobal.delete(localGlobal.keys().next().value as string);
  return n;
}

const globalCapWouldTrip = async (): Promise<boolean> => {
  if (env.WHATSAPP_DAILY_GLOBAL_CAP <= 0) return false;
  const n = await globalCount();
  return n > env.WHATSAPP_DAILY_GLOBAL_CAP;
};

// ─── Enqueue: one moment → one delivery row per recipient ─────────────────────

export async function enqueueForRecipients(input: EnqueueInput): Promise<{ queued: number; suppressed: number }> {
  const { family, coupleId } = input;
  const ids = Array.from(new Set(input.recipientUserIds)).filter((id) => id && id !== input.actorUserId || (id && ACTIVITY_INSENSITIVE_FAMILIES.has(family)));
  if (ids.length === 0) return { queued: 0, suppressed: 0 };

  const [users, couple, prefs, families, todayCounts, lastFamily] = await Promise.all([
    prisma.user.findMany({
      where: { id: { in: ids } },
      select: { id: true, name: true, role: true, phone: true, preferredLocale: true, pushToken: true, lastActiveAt: true },
    }),
    prisma.couple.findUnique({ where: { coupleId }, select: { profileName: true, locationCity: true } }),
    getPreferencesMany(ids),
    enabledFamilies(),
    prisma.nudgeDelivery.groupBy({
      by: ['recipientUserId'],
      where: { recipientUserId: { in: ids }, channel: 'whatsapp', status: { in: SENTISH }, createdAt: { gte: utcDayStart() } },
      _count: { _all: true },
    }),
    prisma.nudgeDelivery.findMany({
      where: { recipientUserId: { in: ids }, family, channel: 'whatsapp', status: { in: SENTISH } },
      orderBy: { createdAt: 'desc' },
      distinct: ['recipientUserId'],
      select: { recipientUserId: true, createdAt: true },
    }),
  ]);

  const activityInsensitive = ACTIVITY_INSENSITIVE_FAMILIES.has(family);
  const channelEnabled = isWhatsAppEnabled();
  const hasTemplate = families.has(family);
  const familyExcluded = HARD_EXCLUDED_FAMILIES.has(family);
  const globalCapReached = false; // enforced at dispatch, where the counter is incremented

  const today = new Map(todayCounts.map((r) => [r.recipientUserId, r._count._all]));
  const last = new Map(lastFamily.map((r) => [r.recipientUserId, r.createdAt]));
  const partners = users.length === 2 ? users : await prisma.user.findMany({ where: { coupleId }, select: { id: true, name: true, role: true } });

  const online = await Promise.all(
    users.map((u) => (activityInsensitive ? Promise.resolve(false) : isUserOnlineGlobal(coupleId, u.id))),
  );

  const now = new Date();
  const rows: Prisma.NudgeDeliveryCreateManyInput[] = users.map((u, i) => {
    const pref = prefs.get(u.id) ?? { whatsappOptIn: true, mutedFamilies: [], whatsappOptOutAt: null };
    const rec: PolicyRecipient = {
      userId: u.id,
      phone: toWhatsAppDigits(u.phone),
      locale: u.preferredLocale,
      hasPushToken: !!u.pushToken,
      lastActiveAt: u.lastActiveAt,
      isOnline: online[i],
      whatsappOptIn: pref.whatsappOptIn,
      mutedFamilies: pref.mutedFamilies,
      sentToday: today.get(u.id) ?? 0,
      lastFamilySentAt: last.get(u.id) ?? null,
    };
    const decision = decide(rec, {
      family,
      channelEnabled,
      hasTemplate,
      familyExcluded,
      activityInsensitive,
      dailyCap: env.NUDGE_DAILY_CAP,
      familyCooldownMin: env.NUDGE_FAMILY_COOLDOWN_MIN,
      activeGraceSec: env.NUDGE_ACTIVE_GRACE_SEC,
      whatsappDelayMin: env.NUDGE_WHATSAPP_DELAY_MIN,
      globalCapReached,
    }, now);

    const partner = partners.find((p) => p.id !== u.id);
    const locale = u.preferredLocale || 'en';
    const ctx = contextFor(
      family,
      input.payload,
      displayName(u, couple?.profileName),
      partner ? displayName(partner, couple?.profileName) : '',
      locale,
      { city: couple?.locationCity ?? undefined, ...input.ctxExtra },
    );

    return {
      eventId: input.eventId ?? null,
      family,
      channel: 'whatsapp',
      recipientUserId: u.id,
      coupleId,
      phone: rec.phone,
      locale,
      status: decision.send ? 'queued' : 'suppressed',
      suppressedReason: decision.send ? null : decision.reason,
      scheduledAt: decision.send ? decision.scheduledAt : now,
      context: ctx as unknown as Prisma.InputJsonValue,
      linkTarget: targetFor(family, input.payload?.data) as unknown as Prisma.InputJsonValue,
    };
  });

  if (rows.length === 0) return { queued: 0, suppressed: 0 };
  await prisma.nudgeDelivery.createMany({ data: rows });
  const queued = rows.filter((r) => r.status === 'queued').length;
  return { queued, suppressed: rows.length - queued };
}

/** The partner invite: a phone we hold from signup, sent alongside the SMS. */
export async function enqueuePartnerInvite(partnerPhone: string): Promise<void> {
  try {
    const user = await prisma.user.findUnique({
      where: { phone: normalizePhone(partnerPhone) },
      select: { id: true, coupleId: true },
    });
    if (!user?.coupleId) {
      logger.info(`[Nudge] partner invite: no user row for ${maskPhone(partnerPhone)}, WhatsApp skipped`);
      return;
    }
    await enqueueForRecipients({ family: 'partner_invite', coupleId: user.coupleId, recipientUserIds: [user.id] });
  } catch (err: any) {
    logger.warn(`[Nudge] enqueuePartnerInvite failed: ${err?.message ?? err}`);
  }
}

// ─── Conversion: the recipient did something within the window ────────────────

export async function markConverted(actorUserId: string | null | undefined, eventType: string): Promise<void> {
  if (!actorUserId) return;
  const since = new Date(Date.now() - NUDGE_CONVERSION_WINDOW_MIN * 60_000);
  try {
    await prisma.nudgeDelivery.updateMany({
      where: {
        recipientUserId: actorUserId,
        convertedAt: null,
        status: { in: ['sent', 'delivered', 'read'] },
        sentAt: { gte: since },
      },
      data: { convertedAt: new Date(), convertedEventType: eventType },
    });
  } catch (err: any) {
    logger.warn(`[Nudge] markConverted failed: ${err?.message ?? err}`);
  }
}

// ─── Outbox drain ─────────────────────────────────────────────────────────────

export async function processOutbox(limit = 100): Promise<number> {
  // Park events that keep failing so they cannot wedge the queue.
  await prisma.engagementEvent.updateMany({
    where: { processedAt: null, attempts: { gte: NUDGE_MAX_EVENT_ATTEMPTS } },
    data: { processedAt: new Date(), lastError: 'gave_up' },
  });

  const claimed = await prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    UPDATE "engagement_events" SET "attempts" = "attempts" + 1
    WHERE "id" IN (
      SELECT "id" FROM "engagement_events"
      WHERE "processedAt" IS NULL AND "attempts" < ${NUDGE_MAX_EVENT_ATTEMPTS}
      ORDER BY "createdAt" ASC
      LIMIT ${limit}
      FOR UPDATE SKIP LOCKED
    )
    RETURNING "id"`);

  let done = 0;
  for (const { id } of claimed) {
    const ev = await prisma.engagementEvent.findUnique({ where: { id } });
    if (!ev) continue;
    try {
      await markConverted(ev.actorUserId, ev.type);
      await enqueueForRecipients({
        family: ev.type,
        coupleId: ev.coupleId,
        recipientUserIds: ev.recipientUserIds,
        actorUserId: ev.actorUserId,
        eventId: ev.id,
        payload: (ev.payload as PushLike | null) ?? null,
      });
      await prisma.engagementEvent.update({ where: { id }, data: { processedAt: new Date(), lastError: null } });
      done += 1;
    } catch (err: any) {
      const msg = String(err?.message ?? err).slice(0, 300);
      logger.warn(`[Nudge] event ${id} (${ev.type}) failed: ${msg}`);
      await prisma.engagementEvent.update({ where: { id }, data: { lastError: msg } }).catch(() => null);
    }
  }
  return done;
}

// ─── Dispatch: due deliveries → provider ──────────────────────────────────────

const SENDING_STUCK_MS = 10 * 60_000;

export async function dispatchDue(limit = 50): Promise<number> {
  // Release rows a crashed worker left mid-send.
  await prisma.nudgeDelivery.updateMany({
    where: { status: 'sending', updatedAt: { lt: new Date(Date.now() - SENDING_STUCK_MS) } },
    data: { status: 'queued' },
  });

  const claimed = await prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    UPDATE "nudge_deliveries" SET "status" = 'sending'::"NudgeStatus", "updatedAt" = NOW()
    WHERE "id" IN (
      SELECT "id" FROM "nudge_deliveries"
      WHERE "status" = 'queued'::"NudgeStatus" AND "scheduledAt" <= NOW()
      ORDER BY "scheduledAt" ASC
      LIMIT ${limit}
      FOR UPDATE SKIP LOCKED
    )
    RETURNING "id"`);
  if (claimed.length === 0) return 0;

  const provider = getWhatsAppProvider();
  let sent = 0;

  for (const { id } of claimed) {
    const finish = (data: Prisma.NudgeDeliveryUpdateInput) =>
      prisma.nudgeDelivery.update({ where: { id }, data }).catch((e) => logger.warn(`[Nudge] finish ${id}: ${e?.message}`));

    const d = await prisma.nudgeDelivery.findUnique({
      where: { id },
      select: { id: true, family: true, coupleId: true, recipientUserId: true, phone: true, locale: true, context: true, linkTarget: true, createdAt: true, scheduledAt: true },
    });
    if (!d) continue;

    if (!provider) { await finish({ status: 'suppressed', suppressedReason: 'disabled' }); continue; }
    if (!d.phone) { await finish({ status: 'suppressed', suppressedReason: 'no_phone' }); continue; }

    // Escalation / race check: they opened Sawa between enqueue and now.
    if (!ACTIVITY_INSENSITIVE_FAMILIES.has(d.family)) {
      const u = await prisma.user.findUnique({ where: { id: d.recipientUserId }, select: { lastActiveAt: true } });
      const opened = !!u?.lastActiveAt && u.lastActiveAt > d.createdAt;
      const online = opened ? true : await isUserOnlineGlobal(d.coupleId, d.recipientUserId);
      if (online) { await finish({ status: 'cancelled', suppressedReason: 'opened_app' }); continue; }
    }

    const template = await resolveTemplate(d.family, d.locale);
    if (!template) { await finish({ status: 'suppressed', suppressedReason: 'no_template' }); continue; }

    if (await globalCapWouldTrip()) {
      logger.error(`[Nudge] WHATSAPP_DAILY_GLOBAL_CAP (${env.WHATSAPP_DAILY_GLOBAL_CAP}) reached — suppressing sends for the rest of the UTC day`);
      await finish({ status: 'suppressed', suppressedReason: 'global_cap' });
      continue;
    }

    const token = newLinkToken();
    const ctx: CopyContext = { ...((d.context as CopyContext | null) ?? {}), link: buildLinkUrl(token) };
    const variables = renderVariables(template.variables, ctx, template.locale);

    // Human-written notes try FREE TEXT first: deliverable only inside the
    // recipient's open 24h session window (they wrote to us recently), where
    // it reads personal. A provider refusal falls through to the template.
    let res: { ok: boolean; providerMessageId?: string; error?: string } | null = null;
    let viaFreeform = false;
    if (FREEFORM_FIRST_FAMILIES.has(d.family) && template.bodyPreview) {
      const text = template.bodyPreview.replace(/\{\{(\d+)\}\}/g, (_m, i) => variables[Number(i) - 1] ?? '');
      const freeform = await provider.sendText(d.phone, text);
      if (freeform.ok) {
        res = freeform;
        viaFreeform = true;
      }
    }
    if (!res) {
      res = await provider.sendTemplate({
        toDigits: d.phone,
        templateName: template.providerName,
        variables,
        label: `sawa_${d.family}_${utcDay()}`,
        locale: template.locale,
      });
    }

    if (res.ok) {
      sent += 1;
      await finish({
        status: 'sent',
        sentAt: new Date(),
        providerMessageId: res.providerMessageId ?? null,
        templateKey: viaFreeform ? 'freeform' : template.providerName,
        variables: variables as unknown as Prisma.InputJsonValue,
        linkToken: token,
        linkTarget: (d.linkTarget ?? targetFor(d.family, undefined)) as unknown as Prisma.InputJsonValue,
        error: null,
      });
      logger.info(`[Nudge] ${d.family} → ${maskPhone(`+${d.phone}`)} via ${provider.name} (${viaFreeform ? 'freeform session' : template.providerName})`);
    } else {
      await finish({
        status: 'failed',
        failedAt: new Date(),
        templateKey: template.providerName,
        variables: variables as unknown as Prisma.InputJsonValue,
        linkToken: token,
        error: res.error ?? 'send_failed',
      });
      logger.warn(`[Nudge] ${d.family} → ${maskPhone(`+${d.phone}`)} FAILED: ${res.error}`);
    }
  }
  return sent;
}

// ─── Provider status callbacks ────────────────────────────────────────────────

export type ProviderStatus = 'sent' | 'delivered' | 'read' | 'failed';

/**
 * Apply a delivery/read/failure callback. Matches by provider message id when
 * we have one, else by the newest send to that phone inside the match window.
 * Stages are monotonic: a late "delivered" never demotes a "read".
 */
export async function handleProviderStatus(input: {
  providerMessageId?: string | null;
  phoneDigits?: string | null;
  status: ProviderStatus;
  error?: string | null;
}): Promise<boolean> {
  let row: { id: string; status: NudgeStatus; providerMessageId: string | null } | null = null;

  if (input.providerMessageId) {
    row = await prisma.nudgeDelivery.findFirst({
      where: { providerMessageId: input.providerMessageId },
      select: { id: true, status: true, providerMessageId: true },
    });
  }
  if (!row && input.phoneDigits) {
    const since = new Date(Date.now() - NUDGE_STATUS_MATCH_HOURS * 3600_000);
    row = await prisma.nudgeDelivery.findFirst({
      where: {
        phone: input.phoneDigits,
        channel: 'whatsapp',
        sentAt: { gte: since },
        status: { in: input.status === 'failed' ? ['sent'] : ['sent', 'delivered', 'read'] },
        ...(input.providerMessageId ? { providerMessageId: null } : {}),
      },
      orderBy: { sentAt: 'desc' },
      select: { id: true, status: true, providerMessageId: true },
    });
  }
  if (!row) return false;

  const now = new Date();
  const data: Prisma.NudgeDeliveryUpdateInput = {};
  if (input.providerMessageId && !row.providerMessageId) data.providerMessageId = input.providerMessageId;

  switch (input.status) {
    case 'delivered':
      if (row.status === 'sent') { data.status = 'delivered'; data.deliveredAt = now; }
      break;
    case 'read':
      if (row.status === 'sent' || row.status === 'delivered') {
        data.status = 'read';
        data.readAt = now;
        if (row.status === 'sent') data.deliveredAt = now;
      }
      break;
    case 'failed':
      if (row.status === 'sent') { data.status = 'failed'; data.failedAt = now; data.error = input.error ?? 'provider_failed'; }
      break;
    case 'sent':
    default:
      break;
  }
  if (Object.keys(data).length === 0) return true;
  await prisma.nudgeDelivery.update({ where: { id: row.id }, data });
  return true;
}
