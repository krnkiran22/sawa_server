import crypto from 'crypto';
import { otpService, formatPhoneE164 } from './otp.service';
import { precheckSmsSendAllowed, maskPhone } from './abuseGuard';
import { revokeUserAccessTokens } from './tokenDenylist';
import { userRepository, normalizePhone } from '../repositories/user.repository';
import { sessionRepository } from '../repositories/session.repository';
import { signAccessToken, signRefreshToken, verifyRefreshToken, denylistAccessToken, tokenExpiryDate } from '../utils/jwt';
import { AppError } from '../utils/AppError';
import { prisma } from '../lib/prisma';
import { logger } from '../utils/logger';
import { TokenPair } from '../types/index';
import { enqueuePartnerInvite } from './nudge/nudge.engine';
import { emitDomainEvent } from './nudge/nudge.events';
import { logAuthEvent } from '../utils/authEvents';
import { env } from '../config/env';

/** Set of phone numbers (with country code) that skip OTP — for test / demo accounts */
const getBypassPhones = (): Set<string> => {
  if (!env.BYPASS_PHONES) return new Set();
  // Secure-by-default: the OTP bypass is a testing/demo backdoor and is DISABLED
  // in production unless an operator explicitly opts in with
  // BYPASS_PHONES_ALLOW_PROD=true. This prevents accidentally shipping a
  // permanent OTP-less login for the listed numbers.
  if (env.NODE_ENV === 'production' && process.env.BYPASS_PHONES_ALLOW_PROD !== 'true') {
    logger.warn('[auth] BYPASS_PHONES is set but ignored in production (set BYPASS_PHONES_ALLOW_PROD=true to force).');
    return new Set();
  }
  // Normalise every entry to bare 10-digit form so the bypass matches
  // regardless of how the number is stored in env or sent by the client
  // (+91…, 91…, or a bare 10-digit number all collapse to the same key).
  return new Set(
    env.BYPASS_PHONES.split(',')
      .map(p => normalizePhone(p.trim()))
      .filter(Boolean),
  );
};

/**
 * Throws if the couple is banned by an admin. Both partners share the ban.
 * Called from every login path so a fresh OTP can't bypass an active ban.
 */
const assertNotBanned = async (coupleId: string | null | undefined): Promise<void> => {
  if (!coupleId) return;
  const couple = await prisma.couple.findUnique({
    where: { coupleId },
    select: { bannedAt: true },
  });
  if (couple?.bannedAt) {
    throw new AppError(
      'This account has been suspended. Please contact support.',
      403,
      'ACCOUNT_BANNED',
    );
  }
};

export class AuthService {
  /**
   * STEP 1 — Send OTP
   */
  async sendOtp(yourPhone: string, partnerPhone: string, ip?: string | null): Promise<{ coupleId: string }> {
    if (yourPhone === partnerPhone) {
      throw new AppError('Your number and partner number cannot be the same', 400, 'SAME_NUMBER');
    }

    // SMS abuse preflight (read-only) — this endpoint is unauthenticated and
    // sends TWO SMS per call, so refuse disallowed/over-budget requests BEFORE
    // any couple/user rows are created and before the first of the two sends.
    // The counting guard inside otpService.generateAndStore stays authoritative.
    await precheckSmsSendAllowed([formatPhoneE164(yourPhone), formatPhoneE164(partnerPhone)], ip);

    const existingYours = await userRepository.findByPhone(yourPhone);
    const existingPartner = await userRepository.findByPhone(partnerPhone);

    // Account-enumeration hardening (M3): distinct "your number" vs "partner
    // number" messages + distinct codes let a caller probe WHICH specific number
    // is already registered (submit the target as one field, a throwaway as the
    // other, read the code). Collapse both into ONE generic code + message so the
    // response no longer reveals which of the two is taken. Residual: it still
    // signals that at least one is registered — inherent to signup UX (a real new
    // user must proceed to OTP, an existing one must be told to sign in) and
    // rate-limited by authRateLimiter + the SMS abuse caps; fully closing it needs
    // a coordinated client change (documented in CHANGELOG). Contract-safe: the
    // mobile SignupScreen only toasts `error` and never branches on the code.
    if (
      (existingYours && existingYours.isPhoneVerified) ||
      (existingPartner && existingPartner.isPhoneVerified)
    ) {
      logAuthEvent('signup.blocked_exists', { phone: yourPhone });
      throw new AppError(
        'An account already exists for one of these numbers. Please sign in instead.',
        400,
        'ACCOUNT_EXISTS',
      );
    }

    // If either phone belongs to a partially-registered banned couple, block reuse.
    await assertNotBanned(existingYours?.coupleId);
    await assertNotBanned(existingPartner?.coupleId);

    // Reuse the pending attempt's coupleId instead of minting a fresh UUID per
    // call. Minting per-attempt was the root of the couple-identity audit's
    // worst class: every abandoned "Send Code" left an orphan couple, and the
    // OTP tokens then disagreed with the (never re-pointed) user rows about
    // which couple the person belongs to. Preference order: your pending row,
    // then the partner's — upsertByPhone re-points whichever row disagrees.
    const coupleId =
      existingYours?.coupleId || existingPartner?.coupleId || crypto.randomUUID();

    // One upsert (not two) — FK constraint satisfied before user rows are created.
    await prisma.couple.upsert({
      where: { coupleId },
      update: {},
      create: { coupleId, profileName: 'Sawa Couple' },
    });

    // Both user rows + both OTPs can be kicked off in parallel once the couple row exists.
    const appUrl = (env.APP_URL || 'https://sawa.living').replace(/\/$/, '');
    const partnerCodeMsg = `Welcome to SAWA! Use {{code}} to verify your shared profile. Download here: ${appUrl}/app`;

    await Promise.all([
      userRepository.upsertByPhone(yourPhone, coupleId, 'primary'),
      userRepository.upsertByPhone(partnerPhone, coupleId, 'partner'),
    ]);

    // keepValidPrevious=true — mirror the login flow. If "Send Code" fires more
    // than once (double-tap, screen re-mount, slow-network retry) the earlier
    // still-valid code from the FIRST SMS keeps working, so the user never sees a
    // spurious "Invalid or expired OTP" for a code they only generated once.
    await Promise.all([
      otpService.generateAndStore(yourPhone, coupleId, undefined, true, ip),
      otpService.generateAndStore(partnerPhone, coupleId, partnerCodeMsg, true, ip),
    ]);

    logAuthEvent('signup.otp_sent', { phone: yourPhone, coupleId });
    return { coupleId };
  }

  /**
   * STEP 2 — Verify OTP
   */
  async verifyOtp(
    yourPhone: string,
    yourOtp: string,
    partnerPhone: string,
    partnerOtp: string,
  ): Promise<{
    coupleId: string;
    yourToken: TokenPair;
    yourUser: {
      id: string;
      name: string;
      role: string;
    };
  }> {
    // PEEK both OTPs (consume: false) and fetch existing user records in one
    // parallel shot. Consuming inside this check burned the user's CORRECT
    // code whenever the partner's code was wrong — after the 90s replay window
    // the correct code then failed too, with no way to know why.
    const [yourResult, partnerResult, existingYours, existingPartner] = await Promise.all([
      otpService.verify(yourPhone, yourOtp, { consume: false }),
      otpService.verify(partnerPhone, partnerOtp, { consume: false }),
      userRepository.findByPhone(yourPhone),
      userRepository.findByPhone(partnerPhone),
    ]);

    if (!yourResult.valid) {
      logAuthEvent('signup.invalid_otp', { phone: yourPhone });
      throw new AppError('Your OTP is invalid or expired', 400, 'INVALID_OTP');
    }
    if (!partnerResult.valid) {
      logAuthEvent('signup.invalid_otp', { phone: partnerPhone, detail: 'partner' });
      throw new AppError("Partner's OTP is invalid or expired", 400, 'INVALID_PARTNER_OTP');
    }

    // Both codes are good — consume them now (writes the replay markers that
    // keep a duplicate submit of the same pair succeeding).
    await Promise.all([
      otpService.verify(yourPhone, yourOtp),
      otpService.verify(partnerPhone, partnerOtp),
    ]);

    const coupleId = yourResult.coupleId!;
    if (partnerResult.coupleId && partnerResult.coupleId !== coupleId) {
      // The partner's code came from a different pending signup session. The
      // pair the CALLER initiated wins; the partner's row is re-pointed inside
      // the transaction below, so DB and JWT stay in agreement.
      logger.warn(
        `[AuthService] Partner OTP carried a different coupleId — converging on the caller's session`,
      );
    }

    const defaultName = (existingYours?.name || existingPartner?.name)
      ? `${existingYours?.name || 'User'} & ${existingPartner?.name || 'Partner'}`
      : 'Sawa Couple';

    // ONE transaction for the whole identity write: couple row, both user
    // rows re-pointed to this coupleId, both marked verified. Before this,
    // the sequence was bare sequential writes — any mid-sequence failure left
    // a half-created identity (couple with no users, verified users pointing
    // at an orphan couple), which is exactly what the field audit found.
    const { couple, yourUser } = await prisma.$transaction(
      async (tx) => {
        const coupleRow = await tx.couple.upsert({
          where: { coupleId },
          update: {},
          create: { coupleId, profileName: defaultName, isProfileComplete: false, isSubscribed: false },
        });

        await userRepository.upsertByPhone(yourPhone, coupleId, 'primary', tx);
        await userRepository.upsertByPhone(partnerPhone, coupleId, 'partner', tx);

        const you = await userRepository.markVerified(yourPhone, tx);
        await userRepository.markVerified(partnerPhone, tx);

        return { couple: coupleRow, yourUser: you };
      },
      { timeout: 10000 },
    );

    // Tokens are minted for THE CALLER ONLY. The old response also signed and
    // returned the partner's access+refresh tokens — full credentials for
    // another person's account, delivered to whoever typed the two numbers
    // (couple-identity audit, critical finding #1). The partner signs in on
    // their own device via login OTP; their row is already verified above.
    const yourAccessToken = signAccessToken({
      userId: yourUser.id,
      coupleMongoId: couple?.id || undefined,
      coupleId,
    });
    const yourRefreshToken = signRefreshToken({
      userId: yourUser.id,
      coupleMongoId: couple?.id || undefined,
      coupleId,
    });

    await sessionRepository.create(
      yourUser.id,
      hashToken(yourRefreshToken),
      tokenExpiryDate(yourRefreshToken),
    );

    logAuthEvent('signup.verified', { phone: yourPhone, coupleId });

    // Welcome both partners (Nudge Layer, 2026-08-31). Outbox write only: the
    // worker applies consent/caps and picks the channel; never blocks signup.
    void userRepository
      .findByPhone(partnerPhone)
      .then((partner) =>
        emitDomainEvent({
          type: 'welcome',
          coupleId,
          actorUserId: yourUser.id,
          recipientUserIds: [yourUser.id, ...(partner ? [partner.id] : [])],
        }),
      )
      .catch(() => null);

    return {
      coupleId,
      yourToken: { accessToken: yourAccessToken, refreshToken: yourRefreshToken },
      yourUser: {
        id: yourUser.id,
        name: yourUser.name || '',
        role: yourUser.role
      }
    };
  }

  /**
   * STEP 3 — Refresh
   */
  async refreshAccessToken(refreshToken: string): Promise<{ accessToken: string; refreshToken: string }> {
    const payload = verifyRefreshToken(refreshToken);
    const presentedHash = hashToken(refreshToken);

    const user = await userRepository.findByIdWithRefreshToken(payload.userId);
    if (!user) {
      throw new AppError('Invalid refresh token', 401, 'INVALID_REFRESH_TOKEN');
    }

    // Multi-session: each device owns a RefreshSession row, so two devices on
    // one account no longer rotate each other's token away (the old single
    // refreshTokenHash slot logged the second device out on every refresh).
    const session = await sessionRepository.findByHash(presentedHash);

    let legacyMatch = false;
    if (!session) {
      // Legacy fallback: tokens issued before the sessions table shipped live
      // in the single slot. Constant-time compare, then migrate the session
      // into the table via the rotation below.
      if (!user.refreshTokenHash) {
        throw new AppError('Invalid refresh token', 401, 'INVALID_REFRESH_TOKEN');
      }
      const presented = Buffer.from(presentedHash, 'utf8');
      const stored = Buffer.from(user.refreshTokenHash, 'utf8');
      if (presented.length !== stored.length || !crypto.timingSafeEqual(presented, stored)) {
        throw new AppError('Refresh token mismatch', 401, 'INVALID_REFRESH_TOKEN');
      }
      legacyMatch = true;
    } else if (session.expiresAt < new Date() || session.userId !== user.id) {
      await sessionRepository.rotate(presentedHash, user.id, presentedHash, new Date(0)).catch(() => {});
      throw new AppError('Invalid refresh token', 401, 'INVALID_REFRESH_TOKEN');
    }

    const resolvedCoupleId = payload.coupleId ?? user.coupleId ?? undefined;

    const accessToken = signAccessToken({
      userId: user.id,
      coupleMongoId: payload.coupleMongoId,
      coupleId: resolvedCoupleId,
    });

    // Rolling refresh — issue a fresh refresh token so the session
    // keeps extending as long as the user is active.
    const newRefreshToken = signRefreshToken({
      userId: user.id,
      coupleMongoId: payload.coupleMongoId,
      coupleId: resolvedCoupleId,
    });
    await sessionRepository.rotate(
      presentedHash,
      user.id,
      hashToken(newRefreshToken),
      tokenExpiryDate(newRefreshToken),
    );
    if (legacyMatch) {
      // The single slot is spent — clear it so the old token can't replay.
      await userRepository.clearRefreshToken(user.id);
    }

    // Opportunistic, off the hot path: expired rows don't accumulate.
    void sessionRepository.pruneExpired().catch(() => {});

    return { accessToken, refreshToken: newRefreshToken };
  }

  /**
   * STEP 4 — Logout (with access-token containment, audit H4)
   *
   * Clearing the refresh hash alone left the ACCESS token valid for its full
   * `JWT_ACCESS_EXPIRES_IN` (7d default) — a stolen token survived logout.
   * The TTL itself deliberately stays unchanged: the admin panel authenticates
   * with the same access tokens and has NO refresh flow, so shortening the
   * lifetime would break admin sessions. Containment instead is Redis-side,
   * on two axes, both enforced by `authenticate` and the socket handshake:
   *  - jti denylist (utils/jwt.ts): kills exactly the token presented here;
   *  - per-user watermark (services/tokenDenylist.ts): kills EVERY access
   *    token issued to this user before this logout — including older copies
   *    an attacker may hold from before a refresh rotation.
   */
  async logout(userId: string, jti?: string, accessTokenExp?: number): Promise<void> {
    await Promise.all([
      userRepository.clearRefreshToken(userId),
      sessionRepository.deleteAllForUser(userId),
      revokeUserAccessTokens(userId),
      denylistAccessToken(jti, accessTokenExp),
    ]);
  }

  /**
   * LOGIN STEP 1
   * For bypass phones: skips OTP entirely and returns access/refresh tokens immediately.
   * For normal phones: sends OTP and returns only the coupleId.
   */
  async loginSendOtp(phone: string, ip?: string | null): Promise<{
    coupleId: string;
    bypass?: true;
    accessToken?: string;
    refreshToken?: string;
    profile?: any;
    user?: { id: string; name: string; role: string };
  }> {
    const user = await userRepository.findByPhone(phone);
    if (!user) {
      logAuthEvent('login.user_not_found', { phone });
      throw new AppError('No account found with this number.', 404, 'USER_NOT_FOUND');
    }

    await assertNotBanned(user.coupleId);

    // ── Bypass: issue tokens immediately, no OTP needed ──────────────────────
    if (getBypassPhones().has(normalizePhone(phone))) {
      logAuthEvent('login.bypass', { phone, coupleId: user.coupleId });

      const couple = user.coupleId
        ? await prisma.couple.upsert({
            where: { coupleId: user.coupleId },
            update: {},
            create: { coupleId: user.coupleId, profileName: user.name || 'Sawa Couple', isProfileComplete: false, isSubscribed: false },
          })
        : null;

      const accessToken = signAccessToken({
        userId: user.id,
        coupleMongoId: couple?.id || undefined,
        coupleId: user.coupleId || undefined,
      });
      const refreshToken = signRefreshToken({
        userId: user.id,
        coupleMongoId: couple?.id || undefined,
        coupleId: user.coupleId || undefined,
      });

      await sessionRepository.create(user.id, hashToken(refreshToken), tokenExpiryDate(refreshToken));

      return {
        coupleId: user.coupleId || '',
        bypass: true,
        accessToken,
        refreshToken,
        profile: couple ? { ...couple, _id: (couple as any).id } : null,
        user: { id: user.id, name: user.name || '', role: user.role },
      };
    }

    // ── Normal flow ───────────────────────────────────────────────────────────
    // If the user row somehow has no coupleId (legacy / migration gap), try
    // to find their couple via the Couple table's partner references before
    // falling back to an empty string (which would cause loginVerifyOtp to
    // generate a fresh UUID and create a new couple from scratch).
    let resolvedCoupleId = user.coupleId;
    if (!resolvedCoupleId) {
      const linked = await prisma.couple.findFirst({
        where: { OR: [{ partner1Id: user.id }, { partner2Id: user.id }] },
        select: { coupleId: true },
      });
      resolvedCoupleId = linked?.coupleId ?? null;
      if (resolvedCoupleId) {
        // Repair the stale user row so future logins won't need this lookup.
        await prisma.user.update({ where: { id: user.id }, data: { coupleId: resolvedCoupleId } });
      }
    }
    // keepValidPrevious=true — don't wipe a still-valid code the user may already
    // have received; avoids "Invalid or expired OTP" when an earlier code is used.
    await otpService.generateAndStore(phone, resolvedCoupleId || '', undefined, true, ip);
    logAuthEvent('login.otp_sent', { phone, coupleId: resolvedCoupleId });
    return { coupleId: resolvedCoupleId || '' };
  }

  /**
   * LOGIN STEP 2
   */
  async loginVerifyOtp(phone: string, otp: string): Promise<{
    coupleId: string;
    token: TokenPair;
    profile: any;
    user: {
      id: string;
      name: string;
      role: string;
    };
  }> {
    // OTP verify + user lookup in parallel — saves one DB round trip.
    const [result, user] = await Promise.all([
      otpService.verify(phone, otp),
      userRepository.findByPhone(phone),
    ]);

    // Only check OTP validity — do NOT gate on coupleId here, since accounts
    // registered before coupleId was reliably stored may have an empty coupleId.
    if (!result.valid) {
      logAuthEvent('login.invalid_otp', { phone });
      throw new AppError('Invalid or expired OTP', 400, 'INVALID_OTP');
    }
    if (!user) {
      throw new AppError('No account found with this number.', 404, 'USER_NOT_FOUND');
    }

    // Resolve coupleId with priority:
    //   1. A couple that REFERENCES this user (partner1/partner2) — the data's
    //      own record of membership, immune to a stale user-row pointer
    //   2. The user row's own coupleId
    //   3. The coupleId stored with the OTP token (set during loginSendOtp)
    // The old order trusted the user row first — which is exactly the pointer
    // the pre-audit signup left stale — and its last resort MINTED A FRESH
    // UUID, silently binding an existing user to a brand-new empty couple and
    // orphaning their real profile ("logged in and it sent me back to the
    // questionnaire"). A login must never create a couple.
    const linked = await prisma.couple.findFirst({
      where: { OR: [{ partner1Id: user.id }, { partner2Id: user.id }] },
      select: { coupleId: true },
      orderBy: { updatedAt: 'desc' },
    });
    const coupleId: string = linked?.coupleId || user.coupleId || result.coupleId || '';

    if (!coupleId) {
      // A verified user with no couple anywhere is broken data, not a flow —
      // fail loudly instead of manufacturing an empty identity.
      logAuthEvent('login.couple_not_found', { phone });
      throw new AppError(
        'We could not find your couple profile. Please register again or contact support.',
        409,
        'COUPLE_NOT_FOUND',
      );
    }

    await assertNotBanned(coupleId);

    // Atomic: ensure the couple row exists (FK target) and repair the user
    // row's pointer in the same transaction, so a mid-sequence failure can't
    // leave the two halves disagreeing again.
    const couple = await prisma.$transaction(
      async (tx) => {
        const coupleRow = await tx.couple.upsert({
          where: { coupleId },
          update: {},
          create: {
            coupleId,
            profileName: user.name || 'Sawa Couple',
            isProfileComplete: false,
            isSubscribed: false,
          },
        });
        if (!user.coupleId || user.coupleId !== coupleId) {
          await tx.user.update({ where: { id: user.id }, data: { coupleId } });
        }
        return coupleRow;
      },
      { timeout: 10000 },
    );

    const accessToken = signAccessToken({
      userId: user.id,
      coupleMongoId: couple.id,
      coupleId,
    });
    const refreshToken = signRefreshToken({
      userId: user.id,
      coupleMongoId: couple.id,
      coupleId,
    });

    await sessionRepository.create(user.id, hashToken(refreshToken), tokenExpiryDate(refreshToken));

    logAuthEvent('login.verified', { phone, coupleId });

    // Same shape as GET /couples/me (formatted, sanitized) — the raw Prisma row
    // used to go out here, so login and profile-fetch returned two different
    // shapes for the same object (audit: response-shape drift). Fall back to
    // the raw-ish row only if formatting fails, so login never breaks on it.
    const { coupleService } = await import('./couple.service');
    const formattedProfile = await coupleService
      .getCouple(coupleId)
      .catch(() => null);

    return {
      coupleId,
      token: { accessToken, refreshToken },
      profile: formattedProfile ?? { ...couple, _id: couple.id },
      user: {
        id: user.id,
        _id: user.id,
        name: user.name || '',
        role: user.role as any,
      } as any,
    };
  }

  /**
   * RESEND OTP — only for one phone at a time.
   * Reuses the existing coupleId so the other partner's OTP is NOT affected.
   * Safe to call multiple times; each call replaces only that phone's OTP.
   */
  async resendOtp(phone: string, ip?: string | null): Promise<void> {
    // Find the coupleId from the existing OTP record for this phone
    const existingToken = await prisma.otpToken.findFirst({
      where: { phone },
      orderBy: { createdAt: 'desc' },
      select: { coupleId: true },
    });

    let coupleId = existingToken?.coupleId;

    // Fallback: look up the user record (handles edge case where OTP was already verified/expired)
    if (!coupleId) {
      const user = await userRepository.findByPhone(phone);
      coupleId = user?.coupleId ?? undefined;
    }

    if (!coupleId) {
      throw new AppError(
        'No active signup session found for this number. Please start registration again.',
        400,
        'NO_SESSION',
      );
    }

    // Regenerate OTP for this phone only — partner's OTP is untouched.
    // keepValidPrevious=true so the previously-sent code still works if the user
    // enters it (common: they resend, then auto-fill grabs the first SMS).
    await otpService.generateAndStore(phone, coupleId, undefined, true, ip);
    logger.info(`[AuthService] OTP resent for ${maskPhone(phone)} (coupleId: ${coupleId})`);
  }

  async sendPartnerInvite(partnerPhone: string, ip?: string | null): Promise<boolean> {
    // Use the server's /app page which auto-detects Android vs iOS and redirects
    // to Play Store or App Store accordingly. Falls back to sawa.living if no APP_URL.
    const appUrl = (env.APP_URL || 'https://sawa.living').replace(/\/$/, '');
    const inviteLink = `${appUrl}/app`;
    // Team-call copy (2026-08-28). The WhatsApp copy rides ONLY when the SMS
    // abuse guard allowed the send, so both channels stay behind one budget.
    const msg = `Your partner has joined Sawa and is waiting for you. Download the app: ${inviteLink}`;
    const sent = await otpService.sendInvitation(partnerPhone, msg, ip);
    if (sent) {
      // WhatsApp copy rides the Nudge Layer (template 'partner_invite', own
      // caps + consent), still gated on the SMS guard having allowed the send.
      void enqueuePartnerInvite(partnerPhone);
    }
    return sent;
  }
}

const hashToken = (token: string): string =>
  crypto.createHash('sha256').update(token).digest('hex');

export const authService = new AuthService();
