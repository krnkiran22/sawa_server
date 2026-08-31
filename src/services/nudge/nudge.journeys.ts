import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { logger } from '../../utils/logger';
import { enqueueForRecipients } from './nudge.engine';
import { enabledFamilies } from './nudge.templates';
import { isWhatsAppEnabled } from './channels/whatsapp.channel';

/**
 * Journeys: proactive nudges defined as DATA (Journey rows, admin-editable),
 * evaluated every 10 minutes by the worker. Four kinds:
 *
 *   partner_waiting  the partner who never opened Sawa, N hours after the
 *                    other finished the profile (steps: 24h, 72h)
 *   after_signup     both partners active, N days after the couple joined
 *                    (first mood / first circle / first game)
 *   schedule         a weekly beat in IST (Friday plan, Sunday check-in)
 *   inactivity       both partners quiet for N days (5, 14, 30), reset when
 *                    either comes back
 *
 * Every candidate still goes through the recipient policy (opt-in, cap,
 * cooldown, online gate), so a journey can never out-shout a couple's
 * settings. Journeys are marketing-priced at Meta; the cap is the budget.
 */

export type JourneyKind = 'partner_waiting' | 'after_signup' | 'schedule' | 'inactivity';

export interface JourneySeed {
  key: string;
  name: string;
  kind: JourneyKind;
  family: string;
  config: Record<string, unknown>;
}

export const JOURNEY_SEEDS: JourneySeed[] = [
  { key: 'partner_waiting', name: 'Partner still waiting', kind: 'partner_waiting', family: 'partner_waiting', config: { afterHours: [24, 72] } },
  { key: 'first_mood', name: 'First week: share a mood', kind: 'after_signup', family: 'first_mood', config: { afterDays: 2 } },
  { key: 'first_circle', name: 'First week: a circle in your city', kind: 'after_signup', family: 'first_circle', config: { afterDays: 4 } },
  { key: 'first_game', name: 'First week: a quick game', kind: 'after_signup', family: 'first_game', config: { afterDays: 6 } },
  { key: 'friday_plan', name: 'Friday plan', kind: 'schedule', family: 'friday_plan', config: { weekday: 5, hourIst: 17 } },
  { key: 'sunday_checkin', name: 'Sunday check-in', kind: 'schedule', family: 'sunday_checkin', config: { weekday: 0, hourIst: 20 } },
  { key: 'quiet_couple', name: 'Quiet couple', kind: 'inactivity', family: 'quiet_couple', config: { inactiveDays: [5, 14, 30] } },
];

const IST_OFFSET_MS = 5.5 * 3600_000;
const DAY_MS = 86_400_000;
const CANDIDATE_CAP = 2000;

const ist = (d = new Date()): { day: string; weekday: number; hour: number } => {
  const t = new Date(d.getTime() + IST_OFFSET_MS);
  return { day: t.toISOString().slice(0, 10), weekday: t.getUTCDay(), hour: t.getUTCHours() };
};

export async function seedJourneys(): Promise<void> {
  try {
    const existing = await prisma.journey.findMany({ select: { key: true } });
    const have = new Set(existing.map((j) => j.key));
    const missing = JOURNEY_SEEDS.filter((s) => !have.has(s.key));
    if (missing.length === 0) return;
    await prisma.journey.createMany({
      data: missing.map((s) => ({
        key: s.key,
        name: s.name,
        kind: s.kind,
        family: s.family,
        config: s.config as Prisma.InputJsonValue,
        enabled: false,
      })),
    });
    logger.info(`[Nudge] seeded ${missing.length} journey row(s) (disabled)`);
  } catch (err: any) {
    logger.warn(`[Nudge] journey seed failed: ${err?.message ?? err}`);
  }
}

type JourneyRow = { id: string; key: string; kind: string; family: string; config: unknown; lastRunAt: Date | null };

const numArray = (v: unknown): number[] =>
  Array.isArray(v) ? v.map(Number).filter((n) => Number.isFinite(n) && n > 0).sort((a, b) => a - b) : [];

// ─── partner_waiting ──────────────────────────────────────────────────────────
async function runPartnerWaiting(j: JourneyRow): Promise<number> {
  const steps = numArray((j.config as any)?.afterHours);
  if (steps.length === 0) return 0;
  const now = Date.now();
  const horizon = new Date(now - (steps[steps.length - 1] + 24) * 3600_000);

  const couples = await prisma.couple.findMany({
    where: { profileCompletedAt: { not: null, gte: horizon }, users: { some: { lastActiveAt: null, phone: { not: null } } } },
    select: { coupleId: true, profileCompletedAt: true, users: { select: { id: true, lastActiveAt: true, phone: true } } },
    take: CANDIDATE_CAP,
  });

  let n = 0;
  for (const c of couples) {
    const waiting = c.users.filter((u) => !u.lastActiveAt && u.phone);
    if (waiting.length !== 1 || !c.profileCompletedAt) continue; // both never active = not this journey
    const target = waiting[0];
    const k = await prisma.nudgeDelivery.count({ where: { recipientUserId: target.id, family: j.family } });
    if (k >= steps.length) continue;
    if (now < c.profileCompletedAt.getTime() + steps[k] * 3600_000) continue;
    const r = await enqueueForRecipients({
      family: j.family,
      coupleId: c.coupleId,
      recipientUserIds: [target.id],
      ctxExtra: { step: String(k + 1) },
    });
    n += r.queued;
  }
  return n;
}

// ─── after_signup ─────────────────────────────────────────────────────────────
async function runAfterSignup(j: JourneyRow): Promise<number> {
  const afterDays = Number((j.config as any)?.afterDays);
  if (!Number.isFinite(afterDays) || afterDays <= 0) return 0;
  const now = Date.now();
  // A one-day window: couples that crossed the threshold since roughly the last tick day.
  const from = new Date(now - (afterDays + 1) * DAY_MS);
  const to = new Date(now - afterDays * DAY_MS);

  const couples = await prisma.couple.findMany({
    where: {
      isProfileComplete: true,
      createdAt: { gte: from, lte: to },
      users: { every: { lastActiveAt: { not: null } } },
    },
    select: { coupleId: true, users: { select: { id: true } } },
    take: CANDIDATE_CAP,
  });

  let n = 0;
  for (const c of couples) {
    const already = await prisma.nudgeDelivery.count({ where: { coupleId: c.coupleId, family: j.family } });
    if (already > 0) continue;
    const r = await enqueueForRecipients({ family: j.family, coupleId: c.coupleId, recipientUserIds: c.users.map((u) => u.id) });
    n += r.queued;
  }
  return n;
}

// ─── schedule ─────────────────────────────────────────────────────────────────
async function runSchedule(j: JourneyRow): Promise<number> {
  const cfg = (j.config as any) ?? {};
  const weekday = Number(cfg.weekday);
  const hourIst = Number(cfg.hourIst);
  const t = ist();
  if (t.weekday !== weekday || t.hour !== hourIst) return 0;
  if (j.lastRunAt && ist(j.lastRunAt).day === t.day) return 0;

  // Claim the run first so a second worker does not double it.
  await prisma.journey.update({ where: { id: j.id }, data: { lastRunAt: new Date() } });

  const active = new Date(Date.now() - 30 * DAY_MS);
  const couples = await prisma.couple.findMany({
    where: { isProfileComplete: true, bannedAt: null, users: { some: { lastActiveAt: { gte: active } } } },
    select: { coupleId: true, locationCity: true, activities: true, users: { select: { id: true } } },
    take: CANDIDATE_CAP,
  });

  // Friday plan: one suggestion per couple from a circle in their city, else
  // one of their own activities. Two queries total, not one per couple.
  const cities = Array.from(new Set(couples.map((c) => c.locationCity).filter((c): c is string => !!c)));
  const circles = j.family === 'friday_plan' && cities.length
    ? await prisma.community.findMany({ where: { city: { in: cities } }, select: { city: true, name: true }, take: 500 })
    : [];
  const circleByCity = new Map<string, string[]>();
  for (const c of circles) {
    if (!c.city) continue;
    const arr = circleByCity.get(c.city) ?? [];
    arr.push(c.name);
    circleByCity.set(c.city, arr);
  }

  let n = 0;
  for (const c of couples) {
    let suggestion = '';
    if (j.family === 'friday_plan') {
      const names = c.locationCity ? circleByCity.get(c.locationCity) ?? [] : [];
      const pick = names.length ? names[Math.floor(Math.random() * names.length)] : '';
      const act = c.activities?.length ? c.activities[Math.floor(Math.random() * c.activities.length)] : '';
      suggestion = pick ? `Your city's ${pick} circle has something on.` : act ? `How about ${act.toLowerCase()}?` : '';
    }
    const r = await enqueueForRecipients({
      family: j.family,
      coupleId: c.coupleId,
      recipientUserIds: c.users.map((u) => u.id),
      ctxExtra: { suggestion, city: c.locationCity ?? undefined },
    });
    n += r.queued;
  }
  return n;
}

// ─── inactivity ───────────────────────────────────────────────────────────────
async function runInactivity(j: JourneyRow): Promise<number> {
  const steps = numArray((j.config as any)?.inactiveDays);
  if (steps.length === 0) return 0;
  const now = Date.now();
  const cutoff = new Date(now - steps[0] * DAY_MS);

  const couples = await prisma.couple.findMany({
    where: {
      isProfileComplete: true,
      bannedAt: null,
      users: { none: { lastActiveAt: { gte: cutoff } }, some: { lastActiveAt: { not: null } } },
    },
    select: { coupleId: true, users: { select: { id: true, lastActiveAt: true } } },
    take: CANDIDATE_CAP,
  });

  let n = 0;
  for (const c of couples) {
    const lastSeen = Math.max(...c.users.map((u) => u.lastActiveAt?.getTime() ?? 0));
    if (!lastSeen) continue;
    // Steps count only since the couple was last seen: a return resets the ladder.
    const k = await prisma.nudgeDelivery.count({
      where: { coupleId: c.coupleId, family: j.family, createdAt: { gt: new Date(lastSeen) } },
    });
    if (k >= steps.length) continue;
    if (now < lastSeen + steps[k] * DAY_MS) continue;
    const r = await enqueueForRecipients({
      family: j.family,
      coupleId: c.coupleId,
      recipientUserIds: c.users.map((u) => u.id),
      ctxExtra: { step: String(k + 1) },
    });
    n += r.queued;
  }
  return n;
}

export async function runJourneys(): Promise<void> {
  if (!isWhatsAppEnabled()) return;
  const [journeys, families] = await Promise.all([
    prisma.journey.findMany({ where: { enabled: true }, select: { id: true, key: true, kind: true, family: true, config: true, lastRunAt: true } }),
    enabledFamilies(),
  ]);
  for (const j of journeys) {
    if (!families.has(j.family)) continue; // template not approved yet: nothing to send with
    try {
      let n = 0;
      switch (j.kind as JourneyKind) {
        case 'partner_waiting': n = await runPartnerWaiting(j); break;
        case 'after_signup': n = await runAfterSignup(j); break;
        case 'schedule': n = await runSchedule(j); break;
        case 'inactivity': n = await runInactivity(j); break;
        default: break;
      }
      if (n > 0) logger.info(`[Nudge] journey ${j.key} queued ${n} WhatsApp nudge(s)`);
    } catch (err: any) {
      logger.warn(`[Nudge] journey ${j.key} failed: ${err?.message ?? err}`);
    }
  }
}
