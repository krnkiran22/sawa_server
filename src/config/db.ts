import { prisma } from '../lib/prisma';
import { logger } from '../utils/logger';

const MAX_RETRIES = 10;
const BASE_DELAY_MS = 3_000; // 3 s initial wait
const MAX_DELAY_MS = 30_000; // cap at 30 s

/**
 * Connect to PostgreSQL via Prisma with exponential-backoff retries.
 * Retries up to MAX_RETRIES times before giving up and exiting.
 * This prevents the PM2 crash-loop when the DB container is still warming up.
 */
export const connectDB = async (): Promise<void> => {
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      await prisma.$connect();
      logger.info('✅  PostgreSQL connected via Prisma');
      return;
    } catch (error) {
      const isLast = attempt === MAX_RETRIES;
      const delay = Math.min(BASE_DELAY_MS * 2 ** (attempt - 1), MAX_DELAY_MS);

      if (isLast) {
        logger.error(`❌  PostgreSQL connection failed after ${MAX_RETRIES} attempts. Exiting.`, error);
        process.exit(1);
      }

      logger.warn(
        `⚠️  PostgreSQL connection attempt ${attempt}/${MAX_RETRIES} failed. Retrying in ${delay / 1000}s…`,
      );
      await new Promise(res => setTimeout(res, delay));
    }
  }
};
