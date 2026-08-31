import { prisma } from '../../lib/prisma';
import { NUDGE_INTENT_TTL_HOURS } from '../../constants/nudge';
import type { LinkTarget } from './nudge.types';

/**
 * Click resolution and deferred intents (the "tap → the exact moment" half of
 * the loop). Public clicks (browser, app not installed) only record; the
 * authenticated resolve is couple-scoped so one couple can never read where
 * another couple's link pointed (RULES §3, the-floor S2).
 */

const asTarget = (v: unknown): LinkTarget | null => {
  if (!v || typeof v !== 'object') return null;
  const t = v as Record<string, unknown>;
  if (typeof t.subtype !== 'string') return null;
  const out: Record<string, string> = {};
  for (const [k, val] of Object.entries(t)) if (typeof val === 'string') out[k] = val;
  return out as LinkTarget;
};

/** Browser hit on /l/:token. Records the click; returns the target for the fallback page. */
export async function recordPublicClick(token: string): Promise<LinkTarget | null> {
  const row = await prisma.nudgeDelivery.findUnique({
    where: { linkToken: token },
    select: { id: true, linkTarget: true, clickedAt: true },
  });
  if (!row) return null;
  if (!row.clickedAt) {
    await prisma.nudgeDelivery.update({ where: { id: row.id }, data: { clickedAt: new Date() } });
  }
  return asTarget(row.linkTarget);
}

/**
 * The app opened on /l/:token and is asking where to go. Marks click + app
 * open + consumed in one write. Null when the token is unknown or belongs to
 * another couple (both answered identically to the client).
 */
export async function resolveLinkForCouple(token: string, coupleId: string): Promise<LinkTarget | null> {
  const row = await prisma.nudgeDelivery.findUnique({
    where: { linkToken: token },
    select: { id: true, coupleId: true, linkTarget: true, clickedAt: true },
  });
  if (!row || row.coupleId !== coupleId) return null;
  const now = new Date();
  await prisma.nudgeDelivery.update({
    where: { id: row.id },
    data: { clickedAt: row.clickedAt ?? now, appOpenedAt: now, intentConsumedAt: now },
  });
  return asTarget(row.linkTarget);
}

/**
 * First login after tapping a link on a phone without the app: hand back the
 * newest clicked, unconsumed target for this user (within the TTL) and retire
 * it, so it replays exactly once.
 */
export async function takePendingIntent(userId: string): Promise<LinkTarget | null> {
  const since = new Date(Date.now() - NUDGE_INTENT_TTL_HOURS * 3600 * 1000);
  const row = await prisma.nudgeDelivery.findFirst({
    where: { recipientUserId: userId, clickedAt: { gte: since }, intentConsumedAt: null },
    orderBy: { clickedAt: 'desc' },
    select: { id: true, linkTarget: true },
  });
  if (!row) return null;
  const now = new Date();
  await prisma.nudgeDelivery.update({
    where: { id: row.id },
    data: { intentConsumedAt: now, appOpenedAt: now },
  });
  return asTarget(row.linkTarget);
}
