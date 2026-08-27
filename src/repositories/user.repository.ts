import { prisma } from '../lib/prisma';
import { AppError } from '../utils/AppError';
import type { Prisma, User } from '@prisma/client';

/** Prisma client OR an interactive-transaction client — repository methods
 *  that participate in the atomic auth writes accept either. */
type Db = Prisma.TransactionClient | typeof prisma;

/**
 * Normalises any phone format to a bare 10-digit string for consistent DB storage.
 * Examples:
 *   +919876543210 → 9876543210
 *   919876543210  → 9876543210
 *   9876543210    → 9876543210
 */
export function normalizePhone(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  if (digits.length === 12 && digits.startsWith('91')) return digits.slice(2);
  if (digits.length === 11 && digits.startsWith('0')) return digits.slice(1);
  return digits;
}

/** The three storage formats legacy rows may carry for one number. */
const phoneVariants = (normalized: string) => [
  { phone: normalized },
  { phone: `91${normalized}` },
  { phone: `+91${normalized}` },
];

export class UserRepository {
  async findByPhone(phone: string, db: Db = prisma): Promise<User | null> {
    const normalized = normalizePhone(phone);
    // Single query covering all three legacy storage formats.
    return db.user.findFirst({ where: { OR: phoneVariants(normalized) } });
  }

  async findById(id: string): Promise<User | null> {
    return prisma.user.findUnique({ where: { id } });
  }

  async findByEntityId(coupleId: string): Promise<User[]> {
    return prisma.user.findMany({ where: { coupleId } });
  }

  /**
   * Create-or-repoint by phone. The old implementation upserted on the bare
   * normalized phone with `update: {}`, which had two field-verified failure
   * modes (the couple-identity audit, 2026-08-27):
   *  - an existing user row KEPT its old coupleId forever, so the JWT (minted
   *    from the OTP token's coupleId) and the DB permanently disagreed about
   *    which couple the person belongs to — orphan couples, ghost users, and
   *    "login lands in the questionnaire" all grew from this;
   *  - a legacy row stored as `91…`/`+91…` didn't match the bare key, so the
   *    upsert CREATED a duplicate user for the same human.
   * Now: resolve the row across all three formats and re-point its coupleId
   * (signup only ever reaches unverified rows — verified numbers are blocked
   * upstream with ACCOUNT_EXISTS). Writes key on id, never on phone.
   */
  async upsertByPhone(
    phone: string,
    coupleId: string,
    role: 'primary' | 'partner',
    db: Db = prisma,
  ): Promise<User> {
    const normalized = normalizePhone(phone);
    const existing = await db.user.findFirst({ where: { OR: phoneVariants(normalized) } });
    if (existing) {
      if (existing.coupleId === coupleId) return existing;
      return db.user.update({ where: { id: existing.id }, data: { coupleId } });
    }
    return db.user.create({ data: { phone: normalized, coupleId, role, isPhoneVerified: false } });
  }

  /**
   * Marks verified by id, resolved across all three phone formats. The old
   * `update({ where: { phone: normalized } })` threw Prisma P2025 (a raw 500)
   * for legacy-format rows — and because the OTP was already consumed by then,
   * the user's first verify was unrecoverable until a fresh SMS.
   */
  async markVerified(phone: string, db: Db = prisma): Promise<User> {
    const normalized = normalizePhone(phone);
    const existing = await db.user.findFirst({ where: { OR: phoneVariants(normalized) } });
    if (!existing) {
      throw new AppError(`User not found for phone`, 404, 'USER_NOT_FOUND');
    }
    if (existing.isPhoneVerified) return existing;
    return db.user.update({ where: { id: existing.id }, data: { isPhoneVerified: true } });
  }

  async saveRefreshTokenHash(userId: string, hash: string): Promise<void> {
    await prisma.user.update({ where: { id: userId }, data: { refreshTokenHash: hash } });
  }

  async clearRefreshToken(userId: string): Promise<void> {
    await prisma.user.update({ where: { id: userId }, data: { refreshTokenHash: null } });
  }

  async findByIdWithRefreshToken(userId: string): Promise<User | null> {
    return prisma.user.findUnique({ where: { id: userId } });
  }

  async update(id: string, data: Partial<User>): Promise<User> {
    const user = await prisma.user.update({ where: { id }, data });
    if (!user) throw new AppError('User not found', 404, 'USER_NOT_FOUND');
    return user;
  }
}

export const userRepository = new UserRepository();
