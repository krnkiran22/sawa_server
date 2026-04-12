import 'dotenv/config';
import { prisma } from '../lib/prisma';

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
  console.log('Starting full database flush (all rows removed)...');
  try {
    const list = TABLES.map((t) => `"${t}"`).join(', ');
    await prisma.$executeRawUnsafe(
      `TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE;`,
    );
    console.log(`Truncated ${TABLES.length} tables in one transaction.`);
    console.log('Database flush complete.');
    process.exit(0);
  } catch (err) {
    console.error('Database flush failed:', err);
    process.exit(1);
  }
}

flushDb();
