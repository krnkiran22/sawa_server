import { Router } from 'express';
import { authenticate } from '../middleware/authenticate';
import { getMe, updateMe, registerPushToken, getPushStatus, testPush } from '../controllers/user.controller';
import { asyncHandler } from '../utils/asyncHandler';

const router = Router();

router.use(authenticate);

router.get('/me', asyncHandler(getMe));
router.patch('/me', asyncHandler(updateMe));
router.post('/me/push-token', asyncHandler(registerPushToken));
// Diagnostic: confirm whether this device has a push token saved
router.get('/me/push-status', asyncHandler(getPushStatus));
router.post('/me/test-push', asyncHandler(testPush));

export default router;
