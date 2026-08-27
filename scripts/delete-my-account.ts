/**
 * delete-my-account.ts
 *
 * Deletes the user + couple record for phone: 6369758396
 * Cascades: OTP tokens, matches, messages, notifications, reports.
 *
 * Run:
 *   cd /Users/kiran/Desktop/sawa_mobile_app/server
 *   npx ts-node --project tsconfig.json scripts/delete-my-account.ts
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const PHONE_VARIANTS = ['6369758396', '+916369758396', '916369758396'];

async function main() {
  console.log('🔍 Looking up user with phone:', PHONE_VARIANTS.join(' / '));

  // ── 1. Find the user ──────────────────────────────────────────────────────
  const user = await prisma.user.findFirst({
    where: { phone: { in: PHONE_VARIANTS } },
  });

  if (!user) {
    console.log('❌ No user found with that phone number. Nothing deleted.');
    return;
  }

  console.log(`✅ Found user  id=${user.id}  coupleId=${user.coupleId ?? 'none'}`);
  const coupleId = user.coupleId;

  // ── 2. All user IDs belonging to the same couple ─────────────────────────
  let allUserIds: string[] = [user.id];
  if (coupleId) {
    const partners = await prisma.user.findMany({
      where: { coupleId },
      select: { id: true },
    });
    allUserIds = partners.map((u) => u.id);
    console.log(`👥 Users in couple: ${allUserIds.join(', ')}`);
  }

  // ── 3. Cascade deletes ───────────────────────────────────────────────────

  if (coupleId) {
    // Notifications (recipientId / senderId are coupleId references)
    const notifDel = await prisma.notification.deleteMany({
      where: { OR: [{ recipientId: coupleId }, { senderId: coupleId }] },
    });
    console.log(`🗑  Notifications deleted: ${notifDel.count}`);

    // Messages (senderId is a coupleId reference)
    const msgDel = await prisma.message.deleteMany({
      where: { senderId: coupleId },
    });
    console.log(`🗑  Messages deleted: ${msgDel.count}`);

    // Matches
    const matchDel = await prisma.match.deleteMany({
      where: { OR: [{ couple1Id: coupleId }, { couple2Id: coupleId }] },
    });
    console.log(`🗑  Matches deleted: ${matchDel.count}`);

    // Reports (reporterId / targetId are coupleId references)
    const reportDel = await prisma.report.deleteMany({
      where: { OR: [{ reporterId: coupleId }, { targetId: coupleId }] },
    });
    console.log(`🗑  Reports deleted: ${reportDel.count}`);
  }

  // OTP tokens keyed by phone
  const otpDel = await prisma.otpToken.deleteMany({
    where: { phone: { in: PHONE_VARIANTS } },
  });
  console.log(`🗑  OTP tokens deleted: ${otpDel.count}`);

  // ── 4. Delete users ───────────────────────────────────────────────────────
  const userDel = await prisma.user.deleteMany({
    where: { id: { in: allUserIds } },
  });
  console.log(`🗑  Users deleted: ${userDel.count}`);

  // ── 5. Delete couple ──────────────────────────────────────────────────────
  if (coupleId) {
    await prisma.couple.delete({ where: { coupleId } }).catch(() => {
      console.log('ℹ️  Couple record already removed — skipping.');
    });
    console.log(`🗑  Couple deleted: ${coupleId}`);
  }

  console.log('\n✅ Done — account fully removed.');
}

main()
  .catch((err) => {
    console.error('❌ Script failed:', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
