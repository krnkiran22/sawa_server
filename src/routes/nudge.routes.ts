import { Router } from 'express';
import { authenticate } from '../middleware/authenticate';
import { asyncHandler } from '../utils/asyncHandler';
import {
  getMyPreferences,
  updateMyPreferences,
  resolveLink,
  pendingIntent,
  validateUpdatePrefs,
  validateLinkParams,
} from '../controllers/nudge.controller';

const router = Router();

router.use(authenticate);

// GET /api/v1/nudges/preferences
router.get('/preferences', asyncHandler(getMyPreferences));

// PUT /api/v1/nudges/preferences
router.put('/preferences', validateUpdatePrefs, asyncHandler(updateMyPreferences));

// GET /api/v1/nudges/links/:token — the app opened on https://<host>/l/:token
router.get('/links/:token', validateLinkParams, asyncHandler(resolveLink));

// GET /api/v1/nudges/pending-intent — replay a tap made before the app was installed
router.get('/pending-intent', asyncHandler(pendingIntent));

export default router;
