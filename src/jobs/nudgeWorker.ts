import { logger } from '../utils/logger';
import { env } from '../config/env';
import {
  NUDGE_DISPATCH_TICK_MS,
  NUDGE_JOURNEY_TICK_MS,
  NUDGE_OUTBOX_TICK_MS,
} from '../constants/nudge';
import { processOutbox, dispatchDue } from '../services/nudge/nudge.engine';
import { seedTemplates } from '../services/nudge/nudge.templates';
import { runJourneys, seedJourneys } from '../services/nudge/nudge.journeys';

/**
 * The Nudge worker. Three loops on one process (pm2 worker 0, same gate as
 * the other jobs in server.ts):
 *   outbox   every 3s   EngagementEvent → per-recipient NudgeDelivery rows
 *   dispatch every 5s   due deliveries → WhatsApp provider
 *   journeys every 10m  proactive nudges (Journey rows)
 *
 * Postgres is the queue: claims use FOR UPDATE SKIP LOCKED so a second worker
 * (a dedicated Fargate task later, NUDGE_WORKER_ENABLED on it, off on the API
 * tasks) can run the same loops without double-sending. Each loop guards
 * against overlapping ticks; a slow provider cannot pile up timers.
 */

const guarded = (name: string, fn: () => Promise<unknown>) => {
  let running = false;
  return async () => {
    if (running) return;
    running = true;
    try {
      await fn();
    } catch (err: any) {
      logger.warn(`[Nudge] ${name} tick failed: ${err?.message ?? err}`);
    } finally {
      running = false;
    }
  };
};

export const startNudgeWorker = (): void => {
  if (!env.NUDGE_WORKER_ENABLED) {
    logger.info('💤 Nudge worker disabled (NUDGE_WORKER_ENABLED=false)');
    return;
  }
  const outbox = guarded('outbox', () => processOutbox());
  const dispatch = guarded('dispatch', () => dispatchDue());
  const journeys = guarded('journeys', () => runJourneys());

  setTimeout(async () => {
    await seedTemplates();
    await seedJourneys();
    setInterval(outbox, NUDGE_OUTBOX_TICK_MS);
    setInterval(dispatch, NUDGE_DISPATCH_TICK_MS);
    setInterval(journeys, NUDGE_JOURNEY_TICK_MS);
    void journeys();
  }, 15_000); // after sockets/db settle, same as the other notifiers

  logger.info(
    `💛 Nudge worker scheduled (outbox ${NUDGE_OUTBOX_TICK_MS / 1000}s, dispatch ${NUDGE_DISPATCH_TICK_MS / 1000}s, journeys ${NUDGE_JOURNEY_TICK_MS / 60000}m; WhatsApp ${env.WHATSAPP_NOTIFICATIONS_ENABLED ? `on via ${env.WHATSAPP_PROVIDER}` : 'off'})`,
  );
};
