/**
 * ═══ SHARED CONTRACT — SOURCE OF TRUTH ═══
 * This file lives in sawa_server/src/contracts and is AUTO-SYNCED into
 * sawa/src/contracts. NEVER edit the mobile copy by hand.
 *   sync : node scripts/syncContracts.mjs          (from sawa_server)
 *   check: node scripts/syncContracts.mjs --check  (fails on drift; in gates)
 */

/** Issued on signup verify, login verify, and refresh. */
export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}
