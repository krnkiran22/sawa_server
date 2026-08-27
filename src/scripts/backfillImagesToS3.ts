/**
 * One-off backfill: move existing base64 image blobs (couple photos + community
 * covers) out of Postgres and into the public S3 image bucket, replacing each
 * value with its stable public URL.
 *
 * SAFE to run repeatedly:
 *  - Only touches values that still start with `data:` (already-migrated URLs
 *    are skipped).
 *  - Refuses to run unless the dedicated public image bucket is configured, so
 *    it can never write non-public (403) URLs.
 *
 * Run:  npx ts-node src/scripts/backfillImagesToS3.ts
 */
import { prisma } from '../lib/prisma';
import {
  materializeImage,
  materializeImages,
  isImageStorageConfigured,
} from '../lib/storage';

async function main(): Promise<void> {
  if (!isImageStorageConfigured()) {
    console.error(
      '❌ Image storage not configured. Set S3_IMAGE_BUCKET and S3_IMAGE_PUBLIC_BASE_URL (plus S3_* creds) before backfilling.',
    );
    process.exit(1);
  }

  console.log('▶ Backfilling couple photos…');
  const couples = await prisma.couple.findMany({
    select: { coupleId: true, primaryPhoto: true, secondaryPhotos: true },
  });

  let coupleUpdates = 0;
  for (const c of couples) {
    const update: { primaryPhoto?: string; secondaryPhotos?: string[] } = {};

    if (c.primaryPhoto && c.primaryPhoto.startsWith('data:')) {
      const url = await materializeImage(c.primaryPhoto, c.coupleId);
      if (url && url !== c.primaryPhoto) update.primaryPhoto = url;
    }

    const secondaries = Array.isArray(c.secondaryPhotos) ? c.secondaryPhotos : [];
    if (secondaries.some((p) => typeof p === 'string' && p.startsWith('data:'))) {
      update.secondaryPhotos = await materializeImages(secondaries, c.coupleId);
    }

    if (Object.keys(update).length > 0) {
      await prisma.couple.update({ where: { coupleId: c.coupleId }, data: update });
      coupleUpdates += 1;
      console.log(`  ✅ ${c.coupleId}: ${Object.keys(update).join(', ')}`);
    }
  }
  console.log(`✔ Couples migrated: ${coupleUpdates}/${couples.length}`);

  console.log('▶ Backfilling community covers…');
  const communities = await prisma.community.findMany({
    select: { id: true, coverImageUrl: true },
  });

  let commUpdates = 0;
  for (const cm of communities) {
    if (cm.coverImageUrl && cm.coverImageUrl.startsWith('data:')) {
      const url = await materializeImage(cm.coverImageUrl);
      if (url && url !== cm.coverImageUrl) {
        await prisma.community.update({ where: { id: cm.id }, data: { coverImageUrl: url } });
        commUpdates += 1;
        console.log(`  ✅ community ${cm.id}`);
      }
    }
  }
  console.log(`✔ Communities migrated: ${commUpdates}/${communities.length}`);

  await prisma.$disconnect();
  console.log('🎉 Backfill complete.');
}

main().catch(async (err) => {
  console.error('Backfill failed:', err);
  await prisma.$disconnect();
  process.exit(1);
});
