import { prisma } from '../lib/prisma';

/**
 * Refresh sessions — one row per live device (RefreshSession in the schema).
 * Every method takes/returns HASHES only; a raw refresh token never reaches
 * this layer (RULES §3). The per-user cap bounds a hostile login loop.
 */
const MAX_SESSIONS_PER_USER = 8;

export class SessionRepository {
  /** Create a session, evicting the oldest beyond the per-user cap. */
  async create(userId: string, tokenHash: string, expiresAt: Date): Promise<void> {
    await prisma.$transaction(async (tx) => {
      await tx.refreshSession.create({ data: { userId, tokenHash, expiresAt } });
      const extras = await tx.refreshSession.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        skip: MAX_SESSIONS_PER_USER,
        select: { id: true },
      });
      if (extras.length > 0) {
        await tx.refreshSession.deleteMany({ where: { id: { in: extras.map((s) => s.id) } } });
      }
    });
  }

  async findByHash(tokenHash: string) {
    return prisma.refreshSession.findUnique({ where: { tokenHash } });
  }

  /**
   * Rotate atomically: the presented session dies and the replacement is born
   * in one transaction, so a crash between the two can't strand the device
   * with neither token valid. deleteMany (not delete) keeps a replayed
   * rotation idempotent instead of throwing P2025.
   */
  async rotate(oldHash: string, userId: string, newHash: string, expiresAt: Date): Promise<void> {
    await prisma.$transaction(async (tx) => {
      await tx.refreshSession.deleteMany({ where: { tokenHash: oldHash } });
      await tx.refreshSession.create({
        data: { userId, tokenHash: newHash, expiresAt, lastUsedAt: new Date() },
      });
    });
  }

  /** Logout-everywhere: every device session for this user dies. */
  async deleteAllForUser(userId: string): Promise<void> {
    await prisma.refreshSession.deleteMany({ where: { userId } });
  }

  /** Opportunistic cleanup — called from the refresh path, never awaited hot. */
  async pruneExpired(): Promise<void> {
    await prisma.refreshSession.deleteMany({ where: { expiresAt: { lt: new Date() } } });
  }
}

export const sessionRepository = new SessionRepository();
