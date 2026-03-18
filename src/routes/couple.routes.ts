import { Router } from 'express';
import { authenticate } from '../middleware/authenticate';
import { asyncHandler } from '../utils/asyncHandler';
import {
  createCouple,
  getMyCouple,
  updateMyCouple,
  submitAnswers,
  invitePartner,
} from '../controllers/couple.controller';

const router = Router();

router.use(authenticate);

// POST /api/v1/couples
router.post('/', asyncHandler(createCouple));

// GET /api/v1/couples/me
router.get('/me', asyncHandler(getMyCouple));

// PATCH /api/v1/couples/me
router.patch('/me', asyncHandler(updateMyCouple));

// POST /api/v1/couples/me/answers
router.post('/me/answers', asyncHandler(submitAnswers));

// POST /api/v1/couples/me/invite
router.post('/me/invite', asyncHandler(invitePartner));

export default router;
