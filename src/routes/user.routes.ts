import { Router } from 'express';
import { authenticate } from '../middleware/authenticate';
import { getMe, updateMe } from '../controllers/user.controller';
import { asyncHandler } from '../utils/asyncHandler';

const router = Router();

router.use(authenticate);

// GET /api/v1/users/me
router.get('/me', asyncHandler(getMe));

// PATCH /api/v1/users/me
router.patch('/me', asyncHandler(updateMe));

export default router;
