/**
 * ═══ SHARED CONTRACT — SOURCE OF TRUTH ═══
 * This file lives in sawa_server/src/contracts and is AUTO-SYNCED into
 * sawa/src/contracts. NEVER edit the mobile copy by hand.
 *   sync : node scripts/syncContracts.mjs          (from sawa_server)
 *   check: node scripts/syncContracts.mjs --check  (fails on drift; in gates)
 */
import type { VerificationStatus } from './profile';

/**
 * One card in GET /matches/discovery — the exact shape the server's
 * formatter emits (match.service.getDiscoveryFeed). The formatter is
 * annotated with this type, so server drift is a compile error there and
 * a sync-check failure here.
 */
export interface DiscoveryCard {
  _id: string;
  coupleId: string;
  profileName: string | null;
  primaryPhoto: string;
  /** Home city, or null when unset (the app localizes the placeholder). */
  location: string | null;
  bio?: string;
  matchCriteria?: string | string[];
  relationshipStatus?: string;
  verificationStatus: VerificationStatus;
  /** Human distance label (e.g. "2.3 km away"); presentation-ready. */
  distance: string;
  tags: string[];
  matchScore: number;
  /** Genuinely-shared facts; [] when nothing real is shared. */
  insights: string[];
}
