/**
 * ═══ SHARED CONTRACT — SOURCE OF TRUTH ═══
 * This file lives in sawa_server/src/contracts and is AUTO-SYNCED into
 * sawa/src/contracts. NEVER edit the mobile copy by hand.
 *   sync : node scripts/syncContracts.mjs          (from sawa_server)
 *   check: node scripts/syncContracts.mjs --check  (fails on drift; in gates)
 */

/** Inclusive by design (team call 2026-08-28); stored per partner. */
export type Gender = 'woman' | 'man' | 'nonbinary' | 'prefer_not_to_say';

/** Admin verification pipeline states. */
export type VerificationStatus = 'pending' | 'verified' | 'rejected';

/** The four onboarding options; legacy rows may hold other strings. */
export type RelationshipStatus =
  | 'Married'
  | 'Engaged'
  | 'Long-Term Relationship'
  | 'Short-Term Relationship';
