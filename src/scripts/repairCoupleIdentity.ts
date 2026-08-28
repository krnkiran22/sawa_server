/**
 * Couple-identity repair — the data half of the 2026-08-27 auth audit.
 *
 * The pre-audit signup path minted a fresh couple UUID per attempt and never
 * re-pointed existing user rows, so production accumulated: users whose
 * coupleId disagrees with the couple that actually references them, couples
 * with users but null partner refs, ghost third users, orphan empty couples,
 * and legacy `91…`/`+91…` phone formats. The code fixes stop NEW damage;
 * this script heals the rows that are already broken — without it, affected
 * users keep landing back in onboarding no matter what the code does.
 *
 * Usage (prod has no shell — run from a machine with DATABASE_URL):
 *   npx ts-node src/scripts/repairCoupleIdentity.ts             # DRY RUN (default)
 *   npx ts-node src/scripts/repairCoupleIdentity.ts --apply     # write repairs
 *   npx ts-node src/scripts/repairCoupleIdentity.ts --apply --purge-orphans
 *
 * Order matters: pointer repair first (it decides which couples are real),
 * then ref backfill, then reporting/purging. Every action prints before it
 * happens; --apply is required for ANY write; orphan deletion additionally
 * requires --purge-orphans and only ever touches couples with nothing behind
 * them (default name, incomplete, no users, no refs, no answers, no photos).
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const APPLY = process.argv.includes('--apply');
const PURGE_ORPHANS = process.argv.includes('--purge-orphans');

const tag = APPLY ? '[APPLY]' : '[DRY-RUN]';

async function main(): Promise<void> {
  console.log(`${tag} couple-identity repair starting${PURGE_ORPHANS ? ' (+purge-orphans)' : ''}`);

  // ── 1. Re-point users whose coupleId disagrees with the couple that
  //       references them. The referencing couple is the data's own record of
  //       membership; prefer a complete one, then the most recently updated. ──
  let repointed = 0;
  const users = await prisma.user.findMany({
    select: { id: true, coupleId: true, phone: true, role: true },
  });
  for (const user of users) {
    const referencing = await prisma.couple.findMany({
      where: { OR: [{ partner1Id: user.id }, { partner2Id: user.id }] },
      select: { coupleId: true, isProfileComplete: true, updatedAt: true },
      orderBy: [{ isProfileComplete: 'desc' }, { updatedAt: 'desc' }],
    });
    const home = referencing[0];
    if (home && user.coupleId !== home.coupleId) {
      console.log(
        `${tag} repoint user ${user.id} (${user.role}): coupleId ${user.coupleId ?? 'null'} → ${home.coupleId}` +
          (home.isProfileComplete ? ' (complete profile)' : ''),
      );
      repointed++;
      if (APPLY) {
        await prisma.user.update({ where: { id: user.id }, data: { coupleId: home.coupleId } });
      }
    }
  }

  // ── 2. Backfill partner refs on couples that have users but null refs
  //       (couples created by the old verify path never set them — and the
  //       onboarding step-derivation requires partner1Id). ──
  let backfilled = 0;
  const refless = await prisma.couple.findMany({
    where: { OR: [{ partner1Id: null }, { partner2Id: null }] },
    select: { coupleId: true, partner1Id: true, partner2Id: true },
  });
  for (const couple of refless) {
    const members = await prisma.user.findMany({
      where: { coupleId: couple.coupleId },
      select: { id: true, role: true },
      orderBy: { createdAt: 'asc' },
    });
    if (members.length === 0) continue;
    const primary = members.find((m) => m.role === 'primary') ?? members[0];
    const partner = members.find((m) => m.role === 'partner' && m.id !== primary.id) ??
      members.find((m) => m.id !== primary.id);
    const data: { partner1Id?: string; partner2Id?: string } = {};
    if (!couple.partner1Id && primary) data.partner1Id = primary.id;
    if (!couple.partner2Id && partner) data.partner2Id = partner.id;
    if (Object.keys(data).length === 0) continue;
    console.log(`${tag} backfill refs on couple ${couple.coupleId}: ${JSON.stringify(data)}`);
    backfilled++;
    if (APPLY) {
      await prisma.couple.update({ where: { coupleId: couple.coupleId }, data });
    }
  }

  // ── 3. Ghost users: more than two users pointing at one couple. Report
  //       only — a human decides (they may hold messages). ──
  const grouped = await prisma.user.groupBy({
    by: ['coupleId'],
    _count: { _all: true },
    having: { coupleId: { _count: { gt: 2 } } },
  });
  for (const g of grouped) {
    if (!g.coupleId) continue;
    const members = await prisma.user.findMany({
      where: { coupleId: g.coupleId },
      select: { id: true, phone: true, role: true, isPhoneVerified: true },
    });
    console.log(
      `${tag} GHOSTS: couple ${g.coupleId} has ${members.length} users — ` +
        members.map((m) => `${m.id}(${m.role}${m.phone ? '' : ',no-phone'})`).join(', '),
    );
  }

  // ── 4. Orphan couples: nothing behind them and nobody points at them. ──
  let orphans = 0;
  const candidates = await prisma.couple.findMany({
    where: {
      isProfileComplete: false,
      profileName: 'Sawa Couple',
      partner1Id: null,
      partner2Id: null,
      primaryPhoto: null,
      answers: { none: {} },
    },
    select: { coupleId: true },
  });
  for (const couple of candidates) {
    const memberCount = await prisma.user.count({ where: { coupleId: couple.coupleId } });
    if (memberCount > 0) continue;
    orphans++;
    if (APPLY && PURGE_ORPHANS) {
      console.log(`${tag} purge orphan couple ${couple.coupleId}`);
      await prisma.otpToken.deleteMany({ where: { coupleId: couple.coupleId } });
      await prisma.couple.delete({ where: { coupleId: couple.coupleId } });
    } else {
      console.log(`${tag} orphan couple ${couple.coupleId} (purge with --apply --purge-orphans)`);
    }
  }

  // ── 5. Legacy phone formats → bare 10-digit (skip on conflict). ──
  let normalized = 0;
  const legacyPhones = await prisma.user.findMany({
    where: { OR: [{ phone: { startsWith: '+91' } }, { phone: { startsWith: '91' } }] },
    select: { id: true, phone: true },
  });
  for (const user of legacyPhones) {
    const digits = (user.phone ?? '').replace(/\D/g, '');
    if (!(digits.length === 12 && digits.startsWith('91'))) continue;
    const bare = digits.slice(2);
    const conflict = await prisma.user.findUnique({ where: { phone: bare }, select: { id: true } });
    if (conflict) {
      console.log(`${tag} CONFLICT: user ${user.id} phone ${user.phone} — bare form owned by ${conflict.id}; human decision needed`);
      continue;
    }
    console.log(`${tag} normalize phone for user ${user.id}: ${user.phone} → ${bare}`);
    normalized++;
    if (APPLY) {
      await prisma.user.update({ where: { id: user.id }, data: { phone: bare } });
    }
  }

  // ── 6. The 'Unknown' city sentinel → NULL. Old builds never sent a city and
  // the old server default stored the literal word, which then rendered
  // verbatim on discovery cards while admin special-cased it away. ──
  const sentinelRows = await prisma.couple.count({ where: { locationCity: 'Unknown' } });
  if (sentinelRows > 0) {
    console.log(`${tag} city sentinel: ${sentinelRows} couple(s) hold locationCity='Unknown' → null`);
    if (APPLY) {
      await prisma.couple.updateMany({
        where: { locationCity: 'Unknown' },
        data: { locationCity: null },
      });
    }
  }

  console.log(
    `${tag} done — repointed=${repointed} backfilled=${backfilled} ` +
      `ghost-couples=${grouped.length} orphans=${orphans}${APPLY && PURGE_ORPHANS ? ' (purged)' : ''} ` +
      `phones-normalized=${normalized} city-sentinels=${sentinelRows}`,
  );
}

main()
  .catch((err) => {
    console.error(`${tag} FAILED:`, err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
