import { prisma } from '../lib/prisma';
import { logger } from '../utils/logger';

/**
 * One-time grandfathering for the admin-verification feature.
 *
 * Every couple that registered BEFORE the feature went live never went through
 * the admin approval queue — they are live, real profiles and must not
 * suddenly show "Unverified" (or flood the admin's pending list). So on boot,
 * any still-`pending` couple created before the feature epoch is promoted to
 * `verified`.
 *
 * Idempotent and cheap: after the first run there are no matching rows, and
 * couples created after the epoch keep the normal pending → approve flow.
 * Runs on the primary worker only (same as ensureSchema/bootstrapAdmin).
 */
const FEATURE_EPOCH = new Date('2026-08-27T14:00:00Z');

export async function backfillVerification(): Promise<void> {
  try {
    const res = await prisma.couple.updateMany({
      where: {
        verificationStatus: 'pending',
        createdAt: { lt: FEATURE_EPOCH },
      },
      data: {
        verificationStatus: 'verified',
        verifiedAt: new Date(),
      },
    });
    if (res.count > 0) {
      logger.info(`[Verification] Grandfathered ${res.count} pre-existing couple(s) as verified`);
    }
  } catch (err: any) {
    // Non-fatal: the column may not exist yet on the very first boot ordering.
    logger.warn(`[Verification] Backfill skipped: ${err.message}`);
  }
}
