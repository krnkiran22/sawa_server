import { prisma } from '../../lib/prisma';
import { normalizePhone } from '../../repositories/user.repository';
import { logger } from '../../utils/logger';
import { maskPhone } from '../abuseGuard';

/**
 * Per-user nudge consent. No row means the defaults (opt-in ON, nothing muted),
 * per the 2026-08-31 decision: consent is disclosed at the OTP screen, and the
 * user can leave any time from Settings or by replying STOP.
 */

export type OptOutSource = 'app' | 'whatsapp_stop' | 'admin';

export interface NudgePreferences {
  whatsappOptIn: boolean;
  mutedFamilies: string[];
  whatsappOptOutAt: string | null;
}

const DEFAULTS: NudgePreferences = { whatsappOptIn: true, mutedFamilies: [], whatsappOptOutAt: null };

export async function getPreferences(userId: string): Promise<NudgePreferences> {
  const row = await prisma.nudgePreference.findUnique({
    where: { userId },
    select: { whatsappOptIn: true, mutedFamilies: true, whatsappOptOutAt: true },
  });
  if (!row) return DEFAULTS;
  return {
    whatsappOptIn: row.whatsappOptIn,
    mutedFamilies: row.mutedFamilies,
    whatsappOptOutAt: row.whatsappOptOutAt ? row.whatsappOptOutAt.toISOString() : null,
  };
}

/** Bulk read for the engine (one query per event, not per recipient). */
export async function getPreferencesMany(userIds: string[]): Promise<Map<string, NudgePreferences>> {
  const out = new Map<string, NudgePreferences>();
  if (userIds.length === 0) return out;
  const rows = await prisma.nudgePreference.findMany({
    where: { userId: { in: userIds } },
    select: { userId: true, whatsappOptIn: true, mutedFamilies: true, whatsappOptOutAt: true },
  });
  for (const r of rows) {
    out.set(r.userId, {
      whatsappOptIn: r.whatsappOptIn,
      mutedFamilies: r.mutedFamilies,
      whatsappOptOutAt: r.whatsappOptOutAt ? r.whatsappOptOutAt.toISOString() : null,
    });
  }
  return out;
}

export async function updatePreferences(
  userId: string,
  patch: { whatsappOptIn?: boolean; mutedFamilies?: string[] },
  source: OptOutSource = 'app',
): Promise<NudgePreferences> {
  const now = new Date();
  const optData =
    patch.whatsappOptIn === undefined
      ? {}
      : patch.whatsappOptIn
        ? { whatsappOptIn: true, whatsappOptInAt: now, optOutSource: null }
        : { whatsappOptIn: false, whatsappOptOutAt: now, optOutSource: source };
  const muteData = patch.mutedFamilies === undefined ? {} : { mutedFamilies: patch.mutedFamilies };

  const row = await prisma.nudgePreference.upsert({
    where: { userId },
    create: { userId, ...optData, ...muteData },
    update: { ...optData, ...muteData },
    select: { whatsappOptIn: true, mutedFamilies: true, whatsappOptOutAt: true },
  });
  return {
    whatsappOptIn: row.whatsappOptIn,
    mutedFamilies: row.mutedFamilies,
    whatsappOptOutAt: row.whatsappOptOutAt ? row.whatsappOptOutAt.toISOString() : null,
  };
}

/**
 * STOP / START from WhatsApp itself. Resolves the phone to a user; unknown
 * numbers are ignored (logged masked). Returns the affected user id, if any.
 */
export async function setOptInByPhone(phone: string, optIn: boolean, source: OptOutSource): Promise<string | null> {
  const normalized = normalizePhone(phone);
  const digits = normalized.replace(/\D/g, '');
  const user = await prisma.user.findFirst({
    where: { OR: [{ phone: normalized }, { phone: `+${digits}` }, { phone: digits }, { phone: digits.slice(-10) }] },
    select: { id: true },
  });
  if (!user) {
    logger.info(`[Nudge] ${optIn ? 'START' : 'STOP'} from unknown number ${maskPhone(normalized)}`);
    return null;
  }
  await updatePreferences(user.id, { whatsappOptIn: optIn }, source);
  logger.info(`[Nudge] user ${user.id} ${optIn ? 'opted back in' : 'opted out'} via ${source}`);
  return user.id;
}
