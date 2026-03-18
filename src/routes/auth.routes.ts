import { Router } from 'express';
import { authRateLimiter } from '../middleware/rateLimiter';
import {
  sendOtp,
  verifyOtp,
  refreshToken,
  logout,
  validateSendOtp,
  validateVerifyOtp,
  validateRefresh,
} from '../controllers/auth.controller';
import { asyncHandler } from '../utils/asyncHandler';
import { authenticate } from '../middleware/authenticate';

const router = Router();

// POST /api/v1/auth/send-otp
router.post('/send-otp', authRateLimiter, validateSendOtp, asyncHandler(sendOtp));

// POST /api/v1/auth/verify-otp
router.post('/verify-otp', authRateLimiter, validateVerifyOtp, asyncHandler(verifyOtp));

// POST /api/v1/auth/refresh
router.post('/refresh', validateRefresh, asyncHandler(refreshToken));

// POST /api/v1/auth/logout  (protected)
router.post('/logout', authenticate, asyncHandler(logout));

export default router;
