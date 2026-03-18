import { Request, Response } from 'express';
import { z } from 'zod';
import { authService } from '../services/auth.service';
import { sendSuccess } from '../utils/response';
import { AppError } from '../utils/AppError';
import { validate } from '../middleware/validate';

// ─── Schemas ────────────────────────────────────────────────────────────────

const SendOtpSchema = z.object({
  yourPhone: z
    .string()
    .min(10, 'Phone must be at least 10 digits')
    .max(15, 'Phone too long')
    .regex(/^\d+$/, 'Phone must contain only digits'),
  partnerPhone: z
    .string()
    .min(10, 'Partner phone must be at least 10 digits')
    .max(15, 'Partner phone too long')
    .regex(/^\d+$/, 'Partner phone must contain only digits'),
});

const VerifyOtpSchema = z.object({
  yourPhone: z.string().min(10).max(15).regex(/^\d+$/),
  yourOtp: z
    .string()
    .length(4, 'OTP must be 4 digits')
    .regex(/^\d+$/, 'OTP must be numeric'),
  partnerPhone: z.string().min(10).max(15).regex(/^\d+$/),
  partnerOtp: z
    .string()
    .length(4, 'Partner OTP must be 4 digits')
    .regex(/^\d+$/, 'OTP must be numeric'),
});

const RefreshSchema = z.object({
  refreshToken: z.string().min(1, 'Refresh token is required'),
});

// ─── Validation Middleware (exported so routes can use them) ─────────────────
export const validateSendOtp = validate(SendOtpSchema);
export const validateVerifyOtp = validate(VerifyOtpSchema);
export const validateRefresh = validate(RefreshSchema);

// ─── Controllers ────────────────────────────────────────────────────────────

/**
 * POST /api/v1/auth/send-otp
 * Body: { yourPhone, partnerPhone }
 *
 * Creates/finds a shared entityId for both phones.
 * Generates dummy OTPs and stores them.
 * In DEV: OTP codes are logged in server console.
 */
export const sendOtp = async (req: Request, res: Response): Promise<void> => {
  const { yourPhone, partnerPhone } = req.body as z.infer<typeof SendOtpSchema>;

  const result = await authService.sendOtp(yourPhone, partnerPhone);

  sendSuccess({
    res,
    statusCode: 200,
    message: 'OTP sent to both numbers',
    data: {
      entityId: result.entityId,
      // In dev, surface the OTP in the response for testing without SMS
      ...(process.env.NODE_ENV !== 'production' && { _devNote: 'Use any 4-digit code to verify in dummy mode' }),
    },
  });
};

/**
 * POST /api/v1/auth/verify-otp
 * Body: { yourPhone, yourOtp, partnerPhone, partnerOtp }
 *
 * DUMMY MODE: accepts any 4-digit entry for both OTPs.
 * Returns JWT token pair for the primary user.
 */
export const verifyOtp = async (req: Request, res: Response): Promise<void> => {
  const { yourPhone, yourOtp, partnerPhone, partnerOtp } =
    req.body as z.infer<typeof VerifyOtpSchema>;

  const result = await authService.verifyOtp(yourPhone, yourOtp, partnerPhone, partnerOtp);

  sendSuccess({
    res,
    statusCode: 200,
    message: 'OTP verified successfully',
    data: {
      entityId: result.entityId,
      accessToken: result.yourToken.accessToken,
      refreshToken: result.yourToken.refreshToken,
      // Partner tokens returned so the partner device can also log in
      partnerAccessToken: result.partnerToken.accessToken,
      partnerRefreshToken: result.partnerToken.refreshToken,
    },
  });
};

/**
 * POST /api/v1/auth/refresh
 * Body: { refreshToken }
 */
export const refreshToken = async (req: Request, res: Response): Promise<void> => {
  const { refreshToken: token } = req.body as z.infer<typeof RefreshSchema>;

  const result = await authService.refreshAccessToken(token);

  sendSuccess({
    res,
    data: { accessToken: result.accessToken },
    message: 'Token refreshed',
  });
};

/**
 * POST /api/v1/auth/logout
 * Protected. Revokes refresh token.
 */
export const logout = async (req: Request, res: Response): Promise<void> => {
  if (!req.user) {
    throw new AppError('Unauthorized', 401);
  }

  await authService.logout(req.user.userId);

  sendSuccess({ res, message: 'Logged out successfully' });
};
