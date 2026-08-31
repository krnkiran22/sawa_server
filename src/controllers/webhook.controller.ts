import { Request, Response } from 'express';
import { env } from '../config/env';
import { logger } from '../utils/logger';
import { sendSuccess, sendError } from '../utils/response';
import { timingSafeEqualStr } from '../utils/timingSafeEqual';
import { handleWatiEvent } from '../services/nudge/nudge.inbound';

/**
 * POST /api/v1/webhooks/wati
 *
 * WATI posts one JSON object per event (some configurations batch an array).
 * The shared secret rides as ?secret= (or x-wati-secret) because WATI does
 * not sign payloads; without WATI_WEBHOOK_SECRET set the endpoint refuses
 * everything, so a forgotten env var fails closed rather than open.
 * Always 200 once authenticated: a provider retry storm on a malformed event
 * helps nobody, and every parse problem is logged.
 */
export const watiWebhook = async (req: Request, res: Response): Promise<void> => {
  const expected = env.WATI_WEBHOOK_SECRET;
  const provided = (req.query.secret as string | undefined) ?? req.header('x-wati-secret');
  if (!expected || !timingSafeEqualStr(provided, expected)) {
    logger.warn('[Nudge] WATI webhook rejected: bad or missing secret');
    sendError({ res, error: 'Unauthorized', statusCode: 401, code: 'UNAUTHORIZED' });
    return;
  }

  const events: unknown[] = Array.isArray(req.body) ? req.body : [req.body];
  let handled = 0;
  for (const ev of events) {
    try {
      await handleWatiEvent(ev);
      handled += 1;
    } catch (err: any) {
      logger.warn(`[Nudge] WATI event failed: ${err?.message ?? err}`);
    }
  }
  sendSuccess({ res, data: { received: events.length, handled } });
};
