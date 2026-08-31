import type { PolicyConfig, PolicyDecision, PolicyRecipient } from './nudge.types';

/**
 * The policy core: given one recipient and the moment's config, decide whether
 * a WhatsApp goes out, and when. Pure and synchronous on purpose: every rule
 * below is unit-tested in __tests__/nudge.policy.test.ts, and the engine only
 * gathers inputs and records the verdict.
 *
 * Rule order is the cheapest-first, most-final-first order. The reasons are
 * stored on the delivery row so admin can see WHY a couple did not hear from
 * us, which is the difference between a tunable system and a mystery.
 *
 * Product decisions encoded here (Arfam, 2026-08-31):
 *  - No quiet hours. The moment something happens, it notifies.
 *  - Opt-in defaults on; STOP and the in-app toggle flip it off instantly.
 *  - Being IN the app right now is the one thing that suppresses a moment
 *    nudge: the socket already delivered it, a WhatsApp on top is noise.
 */
export function decide(rec: PolicyRecipient, cfg: PolicyConfig, now: Date = new Date()): PolicyDecision {
  if (cfg.familyExcluded) return { send: false, reason: 'excluded' };
  if (!cfg.channelEnabled) return { send: false, reason: 'disabled' };
  if (!cfg.hasTemplate) return { send: false, reason: 'no_template' };
  if (!rec.phone) return { send: false, reason: 'no_phone' };
  if (!rec.whatsappOptIn) return { send: false, reason: 'optout' };
  if (rec.mutedFamilies.includes(cfg.family)) return { send: false, reason: 'muted' };

  if (!cfg.activityInsensitive) {
    if (rec.isOnline) return { send: false, reason: 'online' };
    if (rec.lastActiveAt && now.getTime() - rec.lastActiveAt.getTime() < cfg.activeGraceSec * 1000) {
      return { send: false, reason: 'active' };
    }
  }

  if (
    rec.lastFamilySentAt &&
    cfg.familyCooldownMin > 0 &&
    now.getTime() - rec.lastFamilySentAt.getTime() < cfg.familyCooldownMin * 60_000
  ) {
    return { send: false, reason: 'cooldown' };
  }

  if (cfg.dailyCap > 0 && rec.sentToday >= cfg.dailyCap) return { send: false, reason: 'cap' };
  if (cfg.globalCapReached) return { send: false, reason: 'global_cap' };

  // Escalation: someone with push gets the push now and the WhatsApp only if
  // they have not opened the app by then (the dispatcher re-checks). Someone
  // WITHOUT push (partner not installed, token pruned) gets WhatsApp at once.
  const delayMs = rec.hasPushToken && !cfg.activityInsensitive ? cfg.whatsappDelayMin * 60_000 : 0;
  return { send: true, scheduledAt: new Date(now.getTime() + delayMs) };
}

/** UTC day stamp used for per-recipient and global daily counters. */
export const utcDay = (d: Date = new Date()): string => d.toISOString().slice(0, 10);

/** Start of the current UTC day (for "sent today" counts). */
export const utcDayStart = (d: Date = new Date()): Date =>
  new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));

/** Seconds until the UTC day rolls over, for counter TTLs. */
export const secondsToUtcDayEnd = (d: Date = new Date()): number => {
  const end = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1);
  return Math.max(60, Math.ceil((end - d.getTime()) / 1000));
};
