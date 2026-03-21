import crypto from 'crypto';
import { otpService } from './otp.service';

import { userRepository } from '../repositories/user.repository';
import { signAccessToken, signRefreshToken, verifyRefreshToken } from '../utils/jwt';
import { AppError } from '../utils/AppError';
import { Couple } from '../models/Couple.model';
import { User } from '../models/User.model';
import { logger } from '../utils/logger';
import { TokenPair } from '../types/index';

export class AuthService {
  /**
   * STEP 1 — Send OTP
   *
   * Takes yourPhone and partnerPhone.
   * Creates a shared coupleId (like a couple session ID).
   * Generates dummy OTPs for both numbers.
   * Upserts both users in DB (primary + partner roles).
   */
  async sendOtp(yourPhone: string, partnerPhone: string): Promise<{ coupleId: string }> {
    if (yourPhone === partnerPhone) {
      throw new AppError('Your number and partner number cannot be the same', 400, 'SAME_NUMBER');
    }

    // Check if either number already belongs to a verified couple
    const existingYours = await userRepository.findByPhone(yourPhone);
    const existingPartner = await userRepository.findByPhone(partnerPhone);

    // Determine or create the shared coupleId
    let coupleId: string;

    if (existingYours && existingYours.isPhoneVerified) {
      // Returning user — use their existing coupleId
      coupleId = existingYours.coupleId;
    } else if (existingPartner && existingPartner.isPhoneVerified) {
      coupleId = existingPartner.coupleId;
    } else {
      // New couple — generate a fresh coupleId
      coupleId = crypto.randomUUID();
    }

    // Upsert both users under the same coupleId
    await userRepository.upsertByPhone(yourPhone, coupleId, 'primary');
    await userRepository.upsertByPhone(partnerPhone, coupleId, 'partner');

    // Generate dummy OTPs for both (stored in DB, logged in dev)
    await otpService.generateAndStore(yourPhone, coupleId);
    await otpService.generateAndStore(partnerPhone, coupleId);

    logger.info(`[AuthService] OTPs issued for entity: ${coupleId}`);

    return { coupleId };
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
    coupleId: string;
    yourToken: TokenPair;
    partnerToken: TokenPair;
    yourUser: {
      id: string;
      name: string;
      role: string;
    };
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

    // Determine the shared coupleId (prefer your token, then partner token, then existing user)
    let coupleId = yourResult.coupleId!;
    if (coupleId.startsWith('bypass-')) {
        // If both phones are new, create a fresh ID
        if (partnerResult.coupleId?.startsWith('bypass-')) {
            // Check if either user ALREADY exists (maybe legacy data)
            const [uY, uP] = await Promise.all([
                  User.findOne({ phone: yourPhone }),
                  User.findOne({ phone: partnerPhone })
            ]);
            coupleId = uY?.coupleId || uP?.coupleId || crypto.randomUUID();
        } else {
            // Take the partner's legitimate coupleId if they have one
            coupleId = partnerResult.coupleId!;
        }
    }

    // Upsert both users under the same coupleId (ensures they exist before next steps)
    await Promise.all([
      userRepository.upsertByPhone(yourPhone, coupleId, 'primary'),
      userRepository.upsertByPhone(partnerPhone, coupleId, 'partner')
    ]);

    // Mark both as verified
    const [yourUser, partnerUser] = await Promise.all([
      userRepository.markVerified(yourPhone),
      userRepository.markVerified(partnerPhone),
    ]);

    // Find the shared Couple document once
    const couple = await Couple.findOne({ coupleId });

    // Issue JWT tokens for your user (the one on this device)
    const yourAccessToken = signAccessToken({
      userId: yourUser._id.toString(),
      coupleMongoId: couple?._id.toString(),
      coupleId,
    });
    const yourRefreshToken = signRefreshToken({
      userId: yourUser._id.toString(),
      coupleMongoId: couple?._id.toString(),
      coupleId,
    });

    // Issue tokens for partner too (they will receive via their device later)
    const partnerAccessToken = signAccessToken({
      userId: partnerUser._id.toString(),
      coupleMongoId: couple?._id.toString(),
      coupleId,
    });
    const partnerRefreshToken = signRefreshToken({
      userId: partnerUser._id.toString(),
      coupleMongoId: couple?._id.toString(),
      coupleId,
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

    logger.info(`[AuthService] Both users verified. Entity: ${coupleId}`);

    return {
      coupleId,
      yourToken: { accessToken: yourAccessToken, refreshToken: yourRefreshToken },
      partnerToken: { accessToken: partnerAccessToken, refreshToken: partnerRefreshToken },
      yourUser: {
        id: yourUser._id.toString(),
        name: yourUser.name || '',
        role: yourUser.role
      }
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
      coupleMongoId: payload.coupleMongoId, // Reuse from refresh token
      coupleId: payload.coupleId ?? user.coupleId,
    });

    return { accessToken };
  }

  /**
   * STEP 4 — Logout (revoke refresh token)
   */
  async logout(userId: string): Promise<void> {
    await userRepository.clearRefreshToken(userId);
  }
  /**
   * LOGIN STEP 1 — Send OTP for Login
   * Accepts just one phone number, checks if user exists.
   * If yes, generates a dummy OTP.
   */
  async loginSendOtp(phone: string): Promise<{ coupleId: string }> {
    const user = await userRepository.findByPhone(phone);
    if (!user) {
      throw new AppError('No account found with this number. Please sign up first.', 404, 'USER_NOT_FOUND');
    }

    await otpService.generateAndStore(phone, user.coupleId);
    logger.info(`[AuthService] Login OTP issued for user: ${phone}, coupleId: ${user.coupleId}`);

    return { coupleId: user.coupleId };
  }

  /**
   * LOGIN STEP 2 — Verify OTP for Login (DUMMY MODE)
   * Verifies the single OTP and issues JWT token for the user.
   */
  async loginVerifyOtp(
    phone: string,
    otp: string
  ): Promise<{
    coupleId: string;
    token: TokenPair;
    profile: any;
    user: {
      id: string;
      name: string;
      role: string;
    };
  }> {
    const result = await otpService.verify(phone, otp);

    if (!result.valid || !result.coupleId) {
      throw new AppError('Invalid or expired OTP', 400, 'INVALID_OTP');
    }

    let user = await userRepository.findByPhone(phone);
    let coupleId = result.coupleId;

    if (!user) {
       // Master bypass login -> Signup transition
       if (otp === '1234') {
          coupleId = (coupleId.startsWith('bypass-')) ? crypto.randomUUID() : coupleId;
          user = await userRepository.upsertByPhone(phone, coupleId, 'primary');
          await userRepository.markVerified(phone);
       } else {
          throw new AppError('User not found. Please sign up first.', 404, 'USER_NOT_FOUND');
       }
    }

    let couple = await Couple.findOne({ coupleId: user.coupleId });

    // Ensure the Couple document exists so subsequent protected requests (Discovery, Notifications) don't 404.
    if (!couple) {
      console.log(`[AuthService] No Couple doc found for ID ${user.coupleId}. Creating one for user ${user.name}...`);
      couple = await Couple.create({
        coupleId: user.coupleId,
        partner1: user.role === 'primary' ? user._id : undefined,
        partner2: user.role === 'partner' ? user._id : undefined,
        profileName: user.name || 'User',
        isProfileComplete: false,
        isSubscribed: false,
      });
    }

    const accessToken = signAccessToken({
      userId: user._id.toString(),
      coupleMongoId: couple._id.toString(),
      coupleId: user.coupleId,
    });
    
    const refreshToken = signRefreshToken({
      userId: user._id.toString(),
      coupleMongoId: couple?._id.toString(),
      coupleId: user.coupleId,
    });

    await userRepository.saveRefreshTokenHash(
      user._id.toString(),
      hashToken(refreshToken)
    );

    logger.info(`[AuthService] User logged in successfully. coupleId: ${user.coupleId}`);

    return {
      coupleId: user.coupleId,
      token: { accessToken, refreshToken },
      profile: couple || null,
      user: {
        id: user._id.toString(),
        name: user.name || '',
        role: user.role
      }
    };
  }

  /**
   * Send a partner invitation SMS with a deep link to the app.
   */
  async sendPartnerInvite(partnerPhone: string): Promise<boolean> {
    const inviteLink = "https://apps.apple.com/in/app/sawa-made-for-two/id514584879";
    const msg = `Hi! Your partner has invited you to join them on SAWA. Download the app to link your accounts: ${inviteLink}`;
    
    return otpService.sendInvitation(partnerPhone, msg);
  }
}

const hashToken = (token: string): string =>
  crypto.createHash('sha256').update(token).digest('hex');

export const authService = new AuthService();
