import { Request, Response } from 'express';
import { sendSuccess } from '../utils/response';

/**
 * POST /api/v1/auth/send-otp
 * Body: { phone: string }
 */
export const sendOtp = async (req: Request, res: Response): Promise<void> => {
  // TODO Phase 1: validate phone, generate OTP, send via Twilio, store hash in OtpToken
  sendSuccess({ res, message: 'OTP sent successfully [stub]' });
};

/**
 * POST /api/v1/auth/verify-otp
 * Body: { phone: string, otp: string }
 */
export const verifyOtp = async (req: Request, res: Response): Promise<void> => {
  // TODO Phase 1: verify OTP hash, mark phone verified, upsert User, return token pair
  sendSuccess({ res, data: { accessToken: 'stub', refreshToken: 'stub' }, message: 'OTP verified [stub]' });
};

/**
 * POST /api/v1/auth/refresh
 * Body: { refreshToken: string }
 */
export const refreshToken = async (req: Request, res: Response): Promise<void> => {
  // TODO Phase 1: verify refresh token, issue new access token
  sendSuccess({ res, data: { accessToken: 'stub' }, message: 'Token refreshed [stub]' });
};

/**
 * POST /api/v1/auth/logout
 * Protected. Revokes refresh token.
 */
export const logout = async (req: Request, res: Response): Promise<void> => {
  // TODO Phase 1: hash refresh token, remove from User.refreshTokenHash
  sendSuccess({ res, message: 'Logged out successfully [stub]' });
};
