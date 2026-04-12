import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';

/**
 * Load DATABASE_URL from the first env file that defines it.
 * Order: server/.env, cwd .env, repo root .env (so `npm run db:flush` works from server/).
 */
function loadDatabaseUrlFromEnvFiles(): void {
  const candidates = [
    path.resolve(__dirname, '../../.env'),
    path.resolve(process.cwd(), '.env'),
    path.resolve(process.cwd(), '../.env'),
  ];

  for (const envPath of candidates) {
    if (!fs.existsSync(envPath)) continue;
    dotenv.config({ path: envPath, override: true });
    if (process.env.DATABASE_URL?.trim()) {
      console.log('Loaded env file:', envPath);
      return;
    }
  }
}

loadDatabaseUrlFromEnvFiles();

/** All application tables (Prisma @@map names). Single TRUNCATE avoids partial clears. */
const TABLES = [
  'onboarding_answers',
  'messages',
  'notifications',
  'matches',
  'community_members',
  'community_admins',
  'community_join_requests',
  'reports',
  'otp_tokens',
  'users',
  'couples',
  'communities',
  'prompts',
] as const;

async function flushDb() {
  if (!process.env.DATABASE_URL?.trim()) {
    console.error(
      'DATABASE_URL is not set. Add it to server/.env (same folder as package.json) and run: npm run db:flush',
    );
    process.exit(1);
  }

  const { prisma } = await import('../lib/prisma');

  console.log('Starting full database flush (all rows removed)...');
  try {
    const list = TABLES.map((t) => `"${t}"`).join(', ');
    await prisma.$executeRawUnsafe(
      `TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE;`,
    );
    console.log(`Truncated ${TABLES.length} tables in one transaction.`);
    console.log('Database flush complete.');
    await prisma.$disconnect();
    process.exit(0);
  } catch (err) {
    console.error('Database flush failed:', err);
    await prisma.$disconnect().catch(() => {});
    process.exit(1);
  }
}

flushDb();
