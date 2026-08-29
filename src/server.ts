// Sentry first: instrumentation must initialize before anything else loads.
import './lib/sentry';
import http from 'http';
import { createApp } from './app';
import { connectDB } from './config/db';
import { ensureSchema } from './config/ensureSchema';
import { bootstrapAdmin } from './config/bootstrapAdmin';
import { createSocketServer } from './sockets/index';
import { startCycleNotifier } from './jobs/cycleNotifier';
import { startSubscriptionNotifier } from './jobs/subscriptionNotifier';
import { startEventReminderNotifier } from './jobs/eventReminderNotifier';
import { startCelebrationNotifier } from './jobs/celebrationNotifier';
import { startRejectionPurge } from './jobs/rejectionPurge';
import { migrateUsRedisToPostgres } from './jobs/migrateUsToPg';
import { backfillVerification } from './config/backfillVerification';
import { env } from './config/env';
import { logger } from './utils/logger';

const start = async (): Promise<void> => {
  // 1. Connect to the database
  await connectDB();

  // 1b. Ensure an admin account exists so the dashboard login works after
  //     every deploy. Only the primary worker runs it (idempotent regardless).
  if (!process.env.pm_id || process.env.pm_id === '0') {
    await ensureSchema();
    await bootstrapAdmin();
    // One-time grandfathering: couples that existed before the verification
    // feature are promoted to `verified` (idempotent, no-op afterwards).
    await backfillVerification();
  }

  // 2. Create Express app
  const app = createApp();

  // 3. Create HTTP server
  const httpServer = http.createServer(app);

  // 4. Attach Socket.io
  const io = createSocketServer(httpServer);
  (global as any).io = io;

  // 4b. Background jobs — one worker only.
  if (!process.env.pm_id || process.env.pm_id === '0') {
    // Cycle nudges parked as a later feature (Arfam, 2026-08-20) — off until
    // CYCLE_NOTIFIER_ENABLED; code retained. Pairs with mobile CYCLE_ENABLED.
    if (env.CYCLE_NOTIFIER_ENABLED) {
      startCycleNotifier();
    }
    // Gated: this job's only function is soliciting a Prime purchase the app
    // cannot make (3.1.1). Off until Prime returns as compliant IAP.
    if (env.SUBSCRIPTION_NOTIFIER_ENABLED) {
      startSubscriptionNotifier();
    }
    startEventReminderNotifier();
    startCelebrationNotifier();
    startRejectionPurge();
    // One-time backfill of Us-space data from Redis into Postgres.
    migrateUsRedisToPostgres().catch(() => null);
  }

  // 5. Start listening
  httpServer.listen(env.PORT, () => {
    logger.info(`🚀  SAWA Server running on port ${env.PORT} [${env.NODE_ENV}]`);
    logger.info(`📡  Health check: http://localhost:${env.PORT}/health`);
    logger.info(`🌐  API base:     http://localhost:${env.PORT}/api/v1`);
  });

  // (The Railway-era self-wakeup keep-alive ping was removed 2026-08-29:
  // Fargate tasks never sleep, and the ping only produced Sentry noise.)

  // ─── Graceful Shutdown ──────────────────────────────────────────────────────
  let shuttingDown = false;
  const shutdown = (signal: string): void => {
    if (shuttingDown) return; // ignore duplicate signals
    shuttingDown = true;
    logger.info(`\n⚠️   ${signal} received. Shutting down gracefully...`);

    // Force exit if the graceful drain hasn't finished in time.
    const forceTimer = setTimeout(() => {
      logger.error('❌  Forced shutdown after timeout.');
      process.exit(1);
    }, 10_000);
    forceTimer.unref();

    // 1. Stop accepting new HTTP connections. 2. Close Socket.IO (disconnects
    // clients cleanly). 3. Release the Prisma connection pool. Each step is
    // best-effort so one failing step never blocks the others.
    httpServer.close(async () => {
      logger.info('✅  HTTP server closed.');
      try {
        await new Promise<void>((resolve) => io.close(() => resolve()));
        logger.info('✅  Socket.io closed.');
      } catch (err) {
        logger.error('⚠️  Error closing Socket.io:', err);
      }
      try {
        const { prisma } = await import('./lib/prisma');
        await prisma.$disconnect();
        logger.info('✅  Prisma disconnected.');
      } catch (err) {
        logger.error('⚠️  Error disconnecting Prisma:', err);
      }
      clearTimeout(forceTimer);
      process.exit(0);
    });
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  process.on('unhandledRejection', (reason) => {
    logger.error('Unhandled promise rejection:', reason);
  });

  process.on('uncaughtException', (err) => {
    logger.error('Uncaught exception:', err);
    process.exit(1);
  });
};

start();
