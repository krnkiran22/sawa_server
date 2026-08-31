/**
 * ═══ SHARED CONTRACT — SOURCE OF TRUTH ═══
 * This file lives in sawa_server/src/contracts and is AUTO-SYNCED into
 * sawa/src/contracts. NEVER edit the mobile copy by hand.
 *   sync : node scripts/syncContracts.mjs          (from sawa_server)
 *   check: node scripts/syncContracts.mjs --check  (fails on drift; in gates)
 */

/** GET/PUT /api/v1/nudges/preferences */
export interface NudgePreferencesDto {
  /** WhatsApp updates on/off. Defaults ON (disclosed at the OTP screen); STOP or the Settings toggle flips it. */
  whatsappOptIn: boolean;
  /** Families the user muted individually (reserved; the app ships the single toggle first). */
  mutedFamilies: string[];
  whatsappOptOutAt: string | null;
}

export interface UpdateNudgePreferencesBody {
  whatsappOptIn?: boolean;
  mutedFamilies?: string[];
}

/**
 * Where a tapped nudge lands. Speaks the mobile tap router's vocabulary
 * (Service/notificationRouting.ts): `subtype` first, ids alongside.
 * GET /api/v1/nudges/links/:token and GET /api/v1/nudges/pending-intent.
 */
export type NudgeLinkTargetDto = Record<string, string> & { subtype: string };

/** Public link path the server serves and the app registers as an App Link / Universal Link. */
export const NUDGE_LINK_PATH_PREFIX = '/l/';

/** Custom-scheme shape the fallback page uses: sawa://n/<subtype>?k=v */
export const NUDGE_SCHEME_HOST = 'n';
