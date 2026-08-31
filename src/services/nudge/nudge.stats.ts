import { prisma } from '../../lib/prisma';
import type { NudgeStatus } from '@prisma/client';
import { decodeCursor, encodeCursor } from '../../utils/cursor';
import { maskPhone } from '../abuseGuard';
import { getWhatsAppProvider } from './channels/whatsapp.channel';
import { env } from '../../config/env';

/**
 * The funnel: sent → delivered → read → clicked → app opened → converted, per
 * family. This is the table that answers "did the nudge work" (todo.md §6.2's
 * last gap) and it is what the admin Nudges page renders.
 */

export interface FamilyFunnel {
  family: string;
  queued: number;
  sent: number;
  delivered: number;
  read: number;
  failed: number;
  suppressed: number;
  clicked: number;
  opened: number;
  converted: number;
}

export interface Overview {
  days: number;
  provider: { name: string | null; enabled: boolean; masterSwitch: boolean; configured: string };
  totals: Omit<FamilyFunnel, 'family'>;
  families: FamilyFunnel[];
  suppressedReasons: Array<{ reason: string; count: number }>;
  pendingEvents: number;
  queuedDeliveries: number;
  optedOutUsers: number;
}

const blank = (): Omit<FamilyFunnel, 'family'> => ({
  queued: 0, sent: 0, delivered: 0, read: 0, failed: 0, suppressed: 0, clicked: 0, opened: 0, converted: 0,
});

// A delivered/read row was also sent; a read row was also delivered. Roll up so
// each stage is cumulative and the funnel reads left to right.
const addStatus = (f: Omit<FamilyFunnel, 'family'>, status: NudgeStatus, n: number): void => {
  switch (status) {
    case 'queued':
    case 'sending':
      f.queued += n; break;
    case 'sent':
      f.sent += n; break;
    case 'delivered':
      f.sent += n; f.delivered += n; break;
    case 'read':
      f.sent += n; f.delivered += n; f.read += n; break;
    case 'failed':
      f.failed += n; break;
    case 'suppressed':
    case 'cancelled':
      f.suppressed += n; break;
    default:
      break;
  }
};

export async function getOverview(days: number): Promise<Overview> {
  const since = new Date(Date.now() - days * 86_400_000);
  const where = { channel: 'whatsapp' as const, createdAt: { gte: since } };

  const [byStatus, clicked, opened, converted, reasons, pendingEvents, queuedDeliveries, optedOutUsers] =
    await Promise.all([
      prisma.nudgeDelivery.groupBy({ by: ['family', 'status'], where, _count: { _all: true } }),
      prisma.nudgeDelivery.groupBy({ by: ['family'], where: { ...where, clickedAt: { not: null } }, _count: { _all: true } }),
      prisma.nudgeDelivery.groupBy({ by: ['family'], where: { ...where, appOpenedAt: { not: null } }, _count: { _all: true } }),
      prisma.nudgeDelivery.groupBy({ by: ['family'], where: { ...where, convertedAt: { not: null } }, _count: { _all: true } }),
      prisma.nudgeDelivery.groupBy({
        by: ['suppressedReason'],
        where: { ...where, status: { in: ['suppressed', 'cancelled'] } },
        _count: { _all: true },
      }),
      prisma.engagementEvent.count({ where: { processedAt: null } }),
      prisma.nudgeDelivery.count({ where: { status: { in: ['queued', 'sending'] } } }),
      prisma.nudgePreference.count({ where: { whatsappOptIn: false } }),
    ]);

  const map = new Map<string, FamilyFunnel>();
  const get = (family: string): FamilyFunnel => {
    let f = map.get(family);
    if (!f) { f = { family, ...blank() }; map.set(family, f); }
    return f;
  };
  for (const r of byStatus) addStatus(get(r.family), r.status, r._count._all);
  for (const r of clicked) get(r.family).clicked += r._count._all;
  for (const r of opened) get(r.family).opened += r._count._all;
  for (const r of converted) get(r.family).converted += r._count._all;

  const totals = blank();
  for (const f of map.values()) {
    for (const k of Object.keys(totals) as Array<keyof typeof totals>) totals[k] += f[k];
  }

  const provider = getWhatsAppProvider();
  const configured = env.WHATSAPP_PROVIDER === 'wati'
    ? (env.WATI_API_URL && env.WATI_API_TOKEN ? 'wati: url + token set' : 'wati: WATI_API_URL / WATI_API_TOKEN missing')
    : env.WHATSAPP_PROVIDER === 'twilio'
      ? (env.TWILIO_WHATSAPP_FROM ? 'twilio: sender set' : 'twilio: TWILIO_WHATSAPP_FROM missing')
      : 'no provider selected (WHATSAPP_PROVIDER=none)';

  return {
    days,
    provider: {
      name: provider?.name ?? null,
      enabled: !!provider,
      masterSwitch: env.WHATSAPP_NOTIFICATIONS_ENABLED,
      configured,
    },
    totals,
    families: Array.from(map.values()).sort((a, b) => b.sent - a.sent || a.family.localeCompare(b.family)),
    suppressedReasons: reasons
      .map((r) => ({ reason: r.suppressedReason ?? 'unknown', count: r._count._all }))
      .sort((a, b) => b.count - a.count),
    pendingEvents,
    queuedDeliveries,
    optedOutUsers,
  };
}

export interface DeliveryListItem {
  id: string;
  family: string;
  status: NudgeStatus;
  suppressedReason: string | null;
  templateKey: string | null;
  phone: string | null;
  locale: string | null;
  scheduledAt: string;
  sentAt: string | null;
  deliveredAt: string | null;
  readAt: string | null;
  clickedAt: string | null;
  convertedAt: string | null;
  error: string | null;
  createdAt: string;
}

/** Keyset-paginated deliveries for the admin table (RULES §5 cursor convention). */
export async function listDeliveries(opts: {
  limit: number;
  cursor?: unknown;
  family?: string;
  status?: NudgeStatus;
}): Promise<{ items: DeliveryListItem[]; nextCursor: string | null }> {
  const cur = decodeCursor(opts.cursor);
  const where: any = {};
  if (opts.family) where.family = opts.family;
  if (opts.status) where.status = opts.status;
  if (cur) {
    const key = new Date(cur.key);
    if (!Number.isNaN(key.getTime())) {
      where.OR = [{ createdAt: { lt: key } }, { createdAt: key, id: { lt: cur.id } }];
    }
  }
  const rows = await prisma.nudgeDelivery.findMany({
    where,
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: opts.limit + 1,
    select: {
      id: true, family: true, status: true, suppressedReason: true, templateKey: true, phone: true, locale: true,
      scheduledAt: true, sentAt: true, deliveredAt: true, readAt: true, clickedAt: true, convertedAt: true,
      error: true, createdAt: true,
    },
  });
  const page = rows.slice(0, opts.limit);
  const last = page[page.length - 1];
  const iso = (d: Date | null) => (d ? d.toISOString() : null);
  return {
    items: page.map((r) => ({
      id: r.id,
      family: r.family,
      status: r.status,
      suppressedReason: r.suppressedReason,
      templateKey: r.templateKey,
      phone: r.phone ? maskPhone(`+${r.phone}`) : null,
      locale: r.locale,
      scheduledAt: r.scheduledAt.toISOString(),
      sentAt: iso(r.sentAt),
      deliveredAt: iso(r.deliveredAt),
      readAt: iso(r.readAt),
      clickedAt: iso(r.clickedAt),
      convertedAt: iso(r.convertedAt),
      error: r.error,
      createdAt: r.createdAt.toISOString(),
    })),
    nextCursor: rows.length > opts.limit && last ? encodeCursor(last.createdAt.toISOString(), last.id) : null,
  };
}
