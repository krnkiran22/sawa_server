import crypto from 'crypto';
import { otpService } from './otp.service';

import { userRepository } from '../repositories/user.repository';
import { signAccessToken, signRefreshToken, verifyRefreshToken } from '../utils/jwt';
import { AppError } from '../utils/AppError';
import { logger } from '../utils/logger';
import { TokenPair } from '../types/index';

export class AuthService {
  /**
   * STEP 1 — Send OTP
   *
   * Takes yourPhone and partnerPhone.
   * Creates a shared entityId (like a couple session ID).
   * Generates dummy OTPs for both numbers.
   * Upserts both users in DB (primary + partner roles).
   */
  async sendOtp(yourPhone: string, partnerPhone: string): Promise<{ entityId: string }> {
    if (yourPhone === partnerPhone) {
      throw new AppError('Your number and partner number cannot be the same', 400, 'SAME_NUMBER');
    }

    // Check if either number already belongs to a verified couple
    const existingYours = await userRepository.findByPhone(yourPhone);
    const existingPartner = await userRepository.findByPhone(partnerPhone);

    // Determine or create the shared entityId
    let entityId: string;

    if (existingYours && existingYours.isPhoneVerified) {
      // Returning user — use their existing entityId
      entityId = existingYours.entityId;
    } else if (existingPartner && existingPartner.isPhoneVerified) {
      entityId = existingPartner.entityId;
    } else {
      // New couple — generate a fresh entityId
      entityId = crypto.randomUUID();
    }

    // Upsert both users under the same entityId
    await userRepository.upsertByPhone(yourPhone, entityId, 'primary');
    await userRepository.upsertByPhone(partnerPhone, entityId, 'partner');

    // Generate dummy OTPs for both (stored in DB, logged in dev)
    await otpService.generateAndStore(yourPhone, entityId);
    await otpService.generateAndStore(partnerPhone, entityId);

    logger.info(`[AuthService] OTPs issued for entity: ${entityId}`);

    return { entityId };
  }

  /**
   * STEP 2 — Verify OTP (DUMMY MODE)
   *
   * Accepts any 4-digit entry for both numbers.
   * Marks both users as verified.
   * Returns JWT access + refresh token pair for both users.
   */
  async verifyOtp(
    yourPhone: string,
    yourOtp: string,
    partnerPhone: string,
    partnerOtp: string,
  ): Promise<{
    entityId: string;
    yourToken: TokenPair;
    partnerToken: TokenPair;
  }> {
    // Verify both OTPs (dummy: any non-empty code passes)
    const [yourResult, partnerResult] = await Promise.all([
      otpService.verify(yourPhone, yourOtp),
      otpService.verify(partnerPhone, partnerOtp),
    ]);

    if (!yourResult.valid) {
      throw new AppError('Your OTP is invalid or expired', 400, 'INVALID_OTP');
    }

    if (!partnerResult.valid) {
      throw new AppError("Partner's OTP is invalid or expired", 400, 'INVALID_PARTNER_OTP');
    }

    const entityId = yourResult.entityId!;

    // Mark both as verified
    const [yourUser, partnerUser] = await Promise.all([
      userRepository.markVerified(yourPhone),
      userRepository.markVerified(partnerPhone),
    ]);

    // Issue JWT tokens for your user (the one on this device)
    const yourAccessToken = signAccessToken({
      userId: yourUser._id.toString(),
      entityId,
    });
    const yourRefreshToken = signRefreshToken({
      userId: yourUser._id.toString(),
      entityId,
    });

    // Issue tokens for partner too (they will receive via their device later)
    const partnerAccessToken = signAccessToken({
      userId: partnerUser._id.toString(),
      entityId,
    });
    const partnerRefreshToken = signRefreshToken({
      userId: partnerUser._id.toString(),
      entityId,
    });

    // Store hashed refresh tokens
    await Promise.all([
      userRepository.saveRefreshTokenHash(
        yourUser._id.toString(),
        hashToken(yourRefreshToken),
      ),
      userRepository.saveRefreshTokenHash(
        partnerUser._id.toString(),
        hashToken(partnerRefreshToken),
      ),
    ]);

    logger.info(`[AuthService] Both users verified. Entity: ${entityId}`);

    return {
      entityId,
      yourToken: { accessToken: yourAccessToken, refreshToken: yourRefreshToken },
      partnerToken: { accessToken: partnerAccessToken, refreshToken: partnerRefreshToken },
    };
  }

  /**
   * STEP 3 — Refresh access token
   */
  async refreshAccessToken(refreshToken: string): Promise<{ accessToken: string }> {
    const payload = verifyRefreshToken(refreshToken);

    const user = await userRepository.findByIdWithRefreshToken(payload.userId);
    if (!user || !user.refreshTokenHash) {
      throw new AppError('Invalid refresh token', 401, 'INVALID_REFRESH_TOKEN');
    }

    if (hashToken(refreshToken) !== user.refreshTokenHash) {
      throw new AppError('Refresh token mismatch', 401, 'INVALID_REFRESH_TOKEN');
    }

    const accessToken = signAccessToken({
      userId: user._id.toString(),
      entityId: payload.entityId ?? user.entityId,
    });

    return { accessToken };
  }

  /**
   * STEP 4 — Logout (revoke refresh token)
   */
  async logout(userId: string): Promise<void> {
    await userRepository.clearRefreshToken(userId);
  }
}

const hashToken = (token: string): string =>
  crypto.createHash('sha256').update(token).digest('hex');

export const authService = new AuthService();
