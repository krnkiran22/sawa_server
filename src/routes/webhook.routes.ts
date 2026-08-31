import { Router } from 'express';
import { asyncHandler } from '../utils/asyncHandler';
import { watiWebhook } from '../controllers/webhook.controller';

const router = Router();

// POST /api/v1/webhooks/wati?secret=… — WATI delivery/read status + inbound
// messages (STOP/START, quick replies). Authenticated by the shared secret
// configured on the WATI side, never by a user token.
router.post('/wati', asyncHandler(watiWebhook));

export default router;
