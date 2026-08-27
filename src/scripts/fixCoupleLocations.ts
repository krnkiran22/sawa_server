/**
 * One-time data fix for location consistency.
 *
 * Background: some couples ended up with a `locationCity` that disagreed with
 * their stored GPS coordinates (e.g. city "New Delhi" while coordinates point to
 * Goa). This happened because the browse city filter used to overwrite the
 * profile city (without coordinates). GPS is now the single source of truth, so
 * this script recomputes `locationCity` from the stored coordinates for every
 * couple that has a valid GPS fix.
 *
 * It also reports duplicate couple rows (two rows sharing a partner) so they can
 * be reviewed manually — it never deletes anything.
 *
 * Usage:
 *   Dry run (default, no writes):   ts-node src/scripts/fixCoupleLocations.ts
 *   Apply city recomputation:       ts-node src/scripts/fixCoupleLocations.ts --apply
 *   Clear invalid (emulator) coords: ts-node src/scripts/fixCoupleLocations.ts --clear-invalid
 *   Both at once:                   ts-node src/scripts/fixCoupleLocations.ts --apply --clear-invalid
 */
import { prisma } from '../lib/prisma';
import { cityFromCoords } from '../utils/geo';

const APPLY = process.argv.includes('--apply');
const CLEAR_INVALID = process.argv.includes('--clear-invalid');

type Row = {
  id: string;
  coupleId: string;
  profileName: string | null;
  partner1Id: string | null;
  partner2Id: string | null;
  locationCity: string | null;
  locationLatitude: number | null;
  locationLongitude: number | null;
  isProfileComplete: boolean;
  updatedAt: Date;
};

async function main() {
  console.log(`\n=== Fix couple locations (${APPLY ? 'APPLY' : 'DRY RUN'}${CLEAR_INVALID ? ' + CLEAR-INVALID' : ''}) ===\n`);

  const couples = (await prisma.couple.findMany({
    select: {
      id: true,
      coupleId: true,
      profileName: true,
      partner1Id: true,
      partner2Id: true,
      locationCity: true,
      locationLatitude: true,
      locationLongitude: true,
      isProfileComplete: true,
      updatedAt: true,
    },
  })) as Row[];

  console.log(`Loaded ${couples.length} couples.\n`);

  // ── 1. Recompute city from GPS ────────────────────────────────────────────
  const changes: Array<{ row: Row; from: string | null; to: string }> = [];
  const invalidCoords: Row[] = [];
  let withCoords = 0;

  for (const row of couples) {
    const derived = cityFromCoords(row.locationLatitude, row.locationLongitude);
    const hasCoords =
      row.locationLatitude != null &&
      row.locationLongitude != null &&
      Number.isFinite(row.locationLatitude) &&
      Number.isFinite(row.locationLongitude) &&
      !(row.locationLatitude === 0 && row.locationLongitude === 0);

    if (hasCoords) {
      withCoords++;
      if (!derived) {
        // Coordinates exist but are outside every supported-city radius —
        // almost certainly an emulator or VPN fix (Mountain View, CA etc.).
        invalidCoords.push(row);
      } else if (derived !== (row.locationCity || null)) {
        changes.push({ row, from: row.locationCity, to: derived });
      }
    }
  }

  console.log(`Couples with valid GPS coordinates: ${withCoords}`);
  console.log(`  ...with GPS outside any supported city (emulator/VPN): ${invalidCoords.length}`);
  console.log(`City labels that disagree with GPS and will be corrected: ${changes.length}\n`);

  // Report invalid coordinates
  if (invalidCoords.length > 0) {
    console.log('=== Couples with OUT-OF-RANGE coordinates (will be cleared with --clear-invalid) ===');
    for (const row of invalidCoords) {
      console.log(
        `  ${row.coupleId}  "${row.profileName ?? '—'}"  ` +
          `[${row.locationLatitude}, ${row.locationLongitude}]  city=${row.locationCity ?? 'null'}`,
      );
    }
    console.log();
  }

  for (const c of changes) {
    console.log(
      `  ${c.row.coupleId}  "${c.row.profileName ?? '—'}"  ` +
        `[${c.row.locationLatitude}, ${c.row.locationLongitude}]  ` +
        `${c.from ?? 'null'} -> ${c.to}`,
    );
  }

  if (APPLY && changes.length > 0) {
    console.log(`\nApplying ${changes.length} city corrections...`);
    for (const c of changes) {
      await prisma.couple.update({
        where: { coupleId: c.row.coupleId },
        data: { locationCity: c.to },
      });
    }
    console.log('Done.');
  }

  // Clear invalid (emulator/VPN) coordinates so distance falls back to city centroid
  if (CLEAR_INVALID && invalidCoords.length > 0) {
    console.log(`\nClearing invalid coordinates for ${invalidCoords.length} couple(s)...`);
    for (const row of invalidCoords) {
      await prisma.couple.update({
        where: { coupleId: row.coupleId },
        data: { locationLatitude: null, locationLongitude: null },
      });
      console.log(`  Cleared: ${row.coupleId}  "${row.profileName ?? '—'}"`);
    }
    console.log('Done. These couples will now show "Nearby" until they log in from a real device.');
  } else if (invalidCoords.length > 0 && !CLEAR_INVALID) {
    console.log(`\nTip: re-run with --clear-invalid to null-out the ${invalidCoords.length} out-of-range coordinate(s).`);
  }

  // ── 2. Report duplicate couple rows (shared partner) ──────────────────────
  const byPartner = new Map<string, Row[]>();
  for (const row of couples) {
    for (const pid of [row.partner1Id, row.partner2Id]) {
      if (!pid) continue;
      const list = byPartner.get(pid) ?? [];
      list.push(row);
      byPartner.set(pid, list);
    }
  }

  const dupPartners = [...byPartner.entries()].filter(([, rows]) => {
    const uniqueCouples = new Set(rows.map((r) => r.coupleId));
    return uniqueCouples.size > 1;
  });

  console.log(`\n=== Duplicate couple rows (shared partner): ${dupPartners.length} ===`);
  if (dupPartners.length > 0) {
    console.log('(reported only — not deleted; review before removing)\n');
    for (const [pid, rows] of dupPartners) {
      const unique = [...new Map(rows.map((r) => [r.coupleId, r])).values()].sort(
        (a, b) => b.updatedAt.getTime() - a.updatedAt.getTime(),
      );
      console.log(`Partner ${pid} appears in ${unique.length} couples:`);
      for (const r of unique) {
        const hasCoords = r.locationLatitude != null && r.locationLongitude != null;
        console.log(
          `   - ${r.coupleId}  "${r.profileName ?? '—'}"  ` +
            `city=${r.locationCity ?? 'null'}  coords=${hasCoords ? `[${r.locationLatitude}, ${r.locationLongitude}]` : 'none'}  ` +
            `complete=${r.isProfileComplete}  updated=${r.updatedAt.toISOString()}`,
        );
      }
      const keep = unique.find((r) => r.locationLatitude != null && r.locationLongitude != null) ?? unique[0];
      console.log(`   >> suggested keep: ${keep.coupleId} (most recent with valid GPS)\n`);
    }
  }

  console.log(`\n=== Summary ===`);
  console.log(`City corrections: ${changes.length} ${APPLY ? '(applied)' : '(dry run — re-run with --apply)'}`);
  console.log(`Invalid coords cleared: ${invalidCoords.length} ${CLEAR_INVALID ? '(applied)' : '(dry run — re-run with --clear-invalid)'}`);
  console.log(`Duplicate partners to review: ${dupPartners.length}`);

  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
