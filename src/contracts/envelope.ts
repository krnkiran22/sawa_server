/**
 * ═══ SHARED CONTRACT — SOURCE OF TRUTH ═══
 * This file lives in sawa_server/src/contracts and is AUTO-SYNCED into
 * sawa/src/contracts. NEVER edit the mobile copy by hand.
 *   sync : node scripts/syncContracts.mjs          (from sawa_server)
 *   check: node scripts/syncContracts.mjs --check  (fails on drift; in gates)
 */

/** Every /api/v1 endpoint answers one of these two shapes (utils/response.ts). */
export interface ApiSuccess<T = unknown> {
  success: true;
  data: T;
  message?: string;
}

export interface ApiFailure {
  success: false;
  error: string;
  code?: ErrorCode;
  /** Only on code 'APP_UPDATE_REQUIRED' (the 426 force-update gate). */
  updateUrl?: string;
}

export type ApiEnvelope<T = unknown> = ApiSuccess<T> | ApiFailure;

/**
 * Error codes both sides branch on. The `(string & {})` arm keeps older app
 * builds compiling when the server grows a new code — unknown codes must
 * always fall through to generic handling.
 */
export type KnownErrorCode =
  | 'USER_NOT_FOUND'
  | 'COUPLE_NOT_FOUND'
  | 'ACCOUNT_DELETED'
  | 'ACCOUNT_REJECTED'
  | 'SESSION_INVALID'
  | 'ONBOARDING_INCOMPLETE'
  | 'APP_UPDATE_REQUIRED'
  | 'PARTNER_NOT_JOINED'
  | 'VALIDATION';

export type ErrorCode = KnownErrorCode | (string & {});
