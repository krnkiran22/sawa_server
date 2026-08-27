import { prisma } from '../lib/prisma';
import { coupleService } from '../services/couple.service';
import { logger } from '../utils/logger';

/**
 * Rejected-Account Purge Job
 * ─────────────────────────────────────────────────────────────────────────
 * Admin rejection is two-phase: the couple is locked immediately, but the
 * account is only deleted once the user opens the app, reads the rejection
 * note, and taps Continue. If they never open the app again, the locked
 * account (and both phone numbers) would sit in the DB forever.
 *
 * This job is the backstop: rejected couples whose popup was never
 * acknowledged within PURGE_AFTER_DAYS are deleted via the same cascade the
 * acknowledge endpoint uses (couple + both users + all data), freeing the
 * phone numbers for re-registration.
 */

const PURGE_AFTER_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

export async function runPurge(): Promise<void> {
  const cutoff = new Date(Date.now() - PURGE_AFTER_DAYS * DAY_MS);

  try {
    const stale = await prisma.couple.findMany({
      where: {
        verificationStatus: 'rejected',
        rejectedAt: { lt: cutoff },
      },
      select: { coupleId: true },
    });

    if (stale.length === 0) return;

    logger.info(`[RejectionPurge] Purging ${stale.length} rejected account(s) older than ${PURGE_AFTER_DAYS}d`);
    for (const { coupleId } of stale) {
      try {
        await coupleService.deleteMyCouple(coupleId);
        logger.info(`[RejectionPurge] Deleted unacknowledged rejected couple ${coupleId}`);
      } catch (err: any) {
        // One bad row must not stall the rest of the sweep.
        logger.error(`[RejectionPurge] Failed to delete couple ${coupleId}: ${err.message}`);
      }
    }
  } catch (err: any) {
    logger.error(`[RejectionPurge] Sweep failed: ${err.message}`);
  }
}

export const startRejectionPurge = (): void => {
  setTimeout(() => runPurge().catch(() => {}), 30_000); // after db settles on boot
  setInterval(() => runPurge().catch(() => {}), DAY_MS);
  logger.info(`🧹 Rejection purge scheduled (daily, deletes rejected accounts unacknowledged for ${PURGE_AFTER_DAYS}d)`);
};
