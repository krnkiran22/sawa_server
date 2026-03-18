import mongoose from 'mongoose';
import { env } from './env';
import { logger } from '../utils/logger';

const MAX_RETRIES = 5;
const RETRY_DELAY_MS = 5000;

export const connectDB = async (): Promise<void> => {
  let attempt = 0;

  while (attempt < MAX_RETRIES) {
    try {
      await mongoose.connect(env.MONGODB_URI, {
        dbName: 'sawa_db',
      });
      logger.info('✅  MongoDB connected successfully');
      return;
    } catch (error) {
      attempt += 1;
      logger.error(`❌  MongoDB connection attempt ${attempt} failed:`, error);

      if (attempt < MAX_RETRIES) {
        logger.info(`🔄  Retrying in ${RETRY_DELAY_MS / 1000}s...`);
        await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
      }
    }
  }

  logger.error('❌  MongoDB connection failed after all retries. Exiting.');
  process.exit(1);
};

mongoose.connection.on('disconnected', () => {
  logger.warn('⚠️   MongoDB disconnected');
});

mongoose.connection.on('error', (err) => {
  logger.error('MongoDB error:', err);
});
