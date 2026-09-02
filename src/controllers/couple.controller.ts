import { Request, Response } from 'express';
import { z } from 'zod';
import { coupleService } from '../services/couple.service';
import { matchService } from '../services/match.service';
import { authService } from '../services/auth.service';
import { prisma } from '../lib/prisma';
import { sendSuccess } from '../utils/response';
import { validate } from '../middleware/validate';
import { AppError } from '../utils/AppError';
import { logger } from '../utils/logger';
import { isEnforced } from '../config/subscription';
import { logAuthEvent } from '../utils/authEvents';
import { ageFromDobString } from '../utils/age';
import {
  getCachedCoupleProfile,
  setCachedCoupleProfile,
  invalidateCoupleProfile,
} from '../lib/cache';

// ─── Onboarding step derivation ─────────────────────────────────────────────
/**
 * Derives the onboarding step a couple should resume from, based on what's
 * already persisted in the DB. No extra DB fields required.
 *
 * Steps (in order):
 *   OnboardingLanguage → ProfileSetup → StoryPhoto → Question →
 *   PermissionRequest → Complete
 */
function deriveOnboardingStep(couple: {
  profileName: string | null;
  partner1Id: string | null;
  primaryPhoto: string | null;
  isProfileComplete: boolean;
  answers: { id: string }[];
}): string {
  if (couple.isProfileComplete) return 'Complete';

  // Answers saved → ready for PermissionRequest ("I'm in!" screen)
  if (couple.answers && couple.answers.length > 0) return 'PermissionRequest';

  // Primary photo saved → ready for Question
  if (couple.primaryPhoto) return 'Question';

  // Profile name set (not the default) AND partner linked → ready for StoryPhoto
  const hasRealName = couple.profileName &&
    couple.profileName !== 'Sawa Couple' &&
    couple.profileName.trim().length > 0;
  if (hasRealName && couple.partner1Id) return 'StoryPhoto';

  // Nothing saved yet — start from language selection
  return 'OnboardingLanguage';
}

// ─── Validation ─────────────────────────────────────────────────────────────

// `ageFromDobString` now lives in `src/utils/age.ts` (shared with the couple
// service's public-card age derivation) so the DOB parsing rules can never drift
// between the 18+ gate and the profile card (RULES §7 DRY).

// Optional DOB that, WHEN present and parseable, must be >= 18 (Sawa is 18+).
// Server-side backstop for the client age gate. Empty / absent / unparseable
// values pass through so older app builds that omit DOB aren't broken; only a
// clearly-parseable under-18 date is rejected.
const optionalAdultDob = z
  .string()
  .optional()
  .or(z.literal(''))
  .refine(
    (v) => {
      if (!v) return true;
      const age = ageFromDobString(v);
      return age === null || age >= 18;
    },
    { message: 'You must be 18 or older to use Sawa' },
  );

const genderValue = z.enum(['woman', 'man', 'nonbinary', 'prefer_not_to_say']).optional().or(z.literal(''));

const SetupProfileSchema = z.object({
  yourName: z.string().min(1, 'Your name is required'),
  yourEmail: z.string().optional().or(z.literal('')),
  yourDob: optionalAdultDob,
  yourGender: genderValue,
  partnerName: z.string().min(1, "Partner's name is required"),
  partnerEmail: z.string().optional().or(z.literal('')),
  partnerDob: optionalAdultDob,
  partnerGender: genderValue,
  relationshipStatus: z.string().optional(),
  location: z.object({
    city: z.string().optional(),
    country: z.string().optional(),
  }).optional(),
});

const UploadPhotosSchema = z.object({
  primaryPhotoBase64: z.string().optional(),
  secondaryPhotosBase64: z.array(z.string()).max(3).optional(),
  keepSecondaryPhotoUrls: z.array(z.string()).optional(),
  // Explicit removal — an ABSENT primaryPhotoBase64 means "keep", so the
  // client's ✕-then-save used to be a silent no-op reported as success.
  removePrimaryPhoto: z.boolean().optional(),
});

const SubmitAnswersSchema = z.object({
  answers: z.array(
    z.object({
      questionId: z.string(),
      selectedOptionIds: z.array(z.string()).default([]),
      // Fill-in answers (q12 family): one line, the couple's own words.
      textAnswer: z.string().trim().max(120).optional(),
    })
  ),
});

const CompleteOnboardingSchema = z.object({
  // Profile fields are optional — each step saves data to the server immediately,
  // so a reinstall scenario (no local cache) still works because the DB already
  // has the data from earlier steps.  We only call setupProfile when names are present.
  yourName: z.string().min(1).optional().or(z.literal('')),
  yourEmail: z.string().optional().or(z.literal('')),
  yourDob: optionalAdultDob,
  yourGender: genderValue,
  partnerName: z.string().min(1).optional().or(z.literal('')),
  partnerEmail: z.string().optional().or(z.literal('')),
  partnerDob: optionalAdultDob,
  partnerGender: genderValue,
  relationshipStatus: z.string().optional(),
  primaryPhotoBase64: z.string().optional(),
  secondaryPhotosBase64: z.array(z.string()).max(3).optional(),
  answers: z.array(
    z.object({
      questionId: z.string(),
      selectedOptionIds: z.array(z.string()).default([]),
      textAnswer: z.string().trim().max(120).optional(),
    })
  ).optional().default([]),
  location: z.object({
    city: z.string().optional(),
    country: z.string().optional(),
  }).optional(),
});
 
const UpdateMyCoupleSchema = z.object({
  bio: z.string().optional(),
  relationshipStatus: z.string().optional(),
  isOpenToMeeting: z.boolean().optional(),
  preferences: z.any().optional(),
  activities: z.array(z.string()).optional(),
  matchCriteria: z.union([z.string(), z.array(z.string())]).optional(),
  yourName: z.string().optional(),
  yourDob: z.string().optional(),
  yourEmail: z.string().optional(),
  yourGender: genderValue,
  partnerName: z.string().optional(),
  partnerDob: z.string().optional(),
  partnerEmail: z.string().optional(),
  partnerGender: genderValue,
  location: z
    .object({
      city: z.string().optional(),
      country: z.string().optional(),
    })
    .optional(),
  locationCity: z.string().optional(),
  locationCountry: z.string().optional(),
  locationLatitude: z.number().optional(),
  locationLongitude: z.number().optional(),
});

export const validateSetupProfile = validate(SetupProfileSchema);
export const validateUploadPhotos = validate(UploadPhotosSchema);
export const validateSubmitAnswers = validate(SubmitAnswersSchema);
export const validateCompleteOnboarding = validate(CompleteOnboardingSchema);
export const validateUpdateMyCouple = validate(UpdateMyCoupleSchema);

// ─── Controllers ────────────────────────────────────────────────────────────

/**
 * POST /api/v1/couples/onboarding/profile
 * Saves name, dob, email for both primary and partner users, 
 * and relationship status for the couple.
 * Lazily creates the Couple document if it doesn't exist.
 */
export const setupProfile = async (req: Request, res: Response) => {
  const { userId, coupleId } = req.user!;
  const data = req.body as z.infer<typeof SetupProfileSchema>;

  await coupleService.setupProfile(userId, coupleId!, data);

  sendSuccess({ res, statusCode: 200, message: 'Profile details saved' });
};

/**
 * POST /api/v1/couples/onboarding/photos
 * Simulates uploading base64 photos to a CDN/storage.
 */
export const uploadPhotos = async (req: Request, res: Response) => {
  const { coupleId } = req.user!;
  const data = req.body as z.infer<typeof UploadPhotosSchema>;

  await coupleService.uploadPhotos(coupleId!, data);
  await invalidateCoupleProfile(coupleId!);

  sendSuccess({ res, statusCode: 200, message: 'Photos uploaded successfully' });
};

/**
 * GET /api/v1/couples/onboarding/status
 * Returns the step the couple should resume onboarding from, derived purely
 * from the data already in the DB.  Safe to call on every login.
 */
export const getOnboardingStatus = async (req: Request, res: Response) => {
  const { coupleId, userId } = req.user!;

  const couple = await prisma.couple.findUnique({
    where: { coupleId: coupleId! },
    select: {
      profileName: true,
      partner1Id: true,
      partner2Id: true,
      primaryPhoto: true,
      relationshipStatus: true,
      isProfileComplete: true,
      answers: { select: { id: true } },
      partner1: { select: { id: true, name: true, dob: true, email: true } },
      partner2: { select: { id: true, name: true, dob: true, email: true } },
    },
  });

  if (!couple) {
    throw new AppError('Couple not found', 404);
  }

  const step = deriveOnboardingStep(couple);

  // Return partial profile data so the client can pre-fill onboarding forms
  // after a reinstall without asking the user to retype everything.
  // "your" = the logged-in user, "partner" = the other person.
  const isPartner1 = couple.partner1Id === userId;
  const me = isPartner1 ? couple.partner1 : couple.partner2;
  const other = isPartner1 ? couple.partner2 : couple.partner1;

  const resumeData = {
    step,
    isComplete: couple.isProfileComplete,
    profile: {
      profileName: couple.profileName,
      relationshipStatus: couple.relationshipStatus,
      yourName: me?.name ?? null,
      yourDob: me?.dob ?? null,
      yourEmail: me?.email ?? null,
      partnerName: other?.name ?? null,
      partnerDob: other?.dob ?? null,
      partnerEmail: other?.email ?? null,
    },
    hasPhoto: !!couple.primaryPhoto,
    hasAnswers: (couple.answers?.length ?? 0) > 0,
    userId,
  };

  sendSuccess({ res, data: resumeData });
};

/**
 * POST /api/v1/couples/onboarding/answers
 * Saves onboarding questionnaire answers and marks profile as complete.
 */
export const submitAnswers = async (req: Request, res: Response) => {
  const { coupleId } = req.user!;
  const data = req.body as z.infer<typeof SubmitAnswersSchema>;

  await coupleService.submitAnswers(coupleId!, data.answers);
  await invalidateCoupleProfile(coupleId!);

  sendSuccess({ res, statusCode: 200, message: 'Onboarding completed successfully' });
};

/**
 * POST /api/v1/couples/onboarding/complete
 * Combines profile, photos, and answers in one single unified flow.
 */
export const completeOnboarding = async (req: Request, res: Response) => {
  const { userId, coupleId } = req.user!;
  const data = req.body as z.infer<typeof CompleteOnboardingSchema>;

  logger.info(`[CoupleController] completeOnboarding START for coupleId: ${coupleId}`);

  // 1. Only run setupProfile when names are present in the payload.
  //    Each onboarding step already saves to the server immediately, so on a
  //    reinstall the profile data lives in the DB — we just skip re-saving it.
  const hasProfileData = data.yourName && data.yourName.trim().length > 0
    && data.partnerName && data.partnerName.trim().length > 0;

  if (hasProfileData) {
    await coupleService.setupProfile(userId, coupleId!, data as any);
  } else {
    logger.info(`[CoupleController] completeOnboarding: no profile names in payload — skipping setupProfile (reinstall scenario)`);
  }

  // 2. Parallelize photo and answer saves (both are idempotent / additive).
  const tasks: Promise<any>[] = [];
  if (data.primaryPhotoBase64 || (data.secondaryPhotosBase64 && data.secondaryPhotosBase64.length > 0)) {
    tasks.push(coupleService.uploadPhotos(coupleId!, data));
  }
  if (data.answers && data.answers.length > 0) {
    tasks.push(coupleService.submitAnswers(coupleId!, data.answers));
  }
  if (tasks.length > 0) await Promise.all(tasks);

  // 3. Verify the DB really holds the essentials BEFORE flagging complete.
  //    "Complete" used to be written unconditionally — a mid-sequence failure
  //    (or a payload missing answers) produced couples marked complete with
  //    nothing behind them, or half-saved profiles that bounced back into the
  //    questionnaire on every login (couple-identity audit, 2026-08-27).
  const stored = await prisma.couple.findUnique({
    where: { coupleId: coupleId! },
    select: {
      profileName: true,
      primaryPhoto: true,
      locationCity: true,
      answers: { select: { id: true } },
    },
  });
  const hasRealName =
    !!stored?.profileName &&
    stored.profileName !== 'Sawa Couple' &&
    stored.profileName.trim().length > 0;
  const hasAnswers = (stored?.answers?.length ?? 0) > 0;
  if (!hasRealName || !hasAnswers) {
    logger.warn(
      `[CoupleController] completeOnboarding REFUSED for ${coupleId}: name=${hasRealName} answers=${hasAnswers}`,
    );
    logAuthEvent('onboarding.refused_incomplete', { coupleId });
    throw new AppError(
      'A couple of steps are still missing — please finish your profile.',
      400,
      'ONBOARDING_INCOMPLETE',
    );
  }
  if (!stored?.primaryPhoto) {
    // STRICT since 2026-09-01 (Arfam: the first photo is mandatory — Sailee
    // cannot review a faceless profile). Every build from 1.0.7(14) collects
    // it before this call; a missing one is a defect, not a legacy build.
    logger.warn(`[CoupleController] completeOnboarding REFUSED for ${coupleId}: no primary photo stored`);
    logAuthEvent('onboarding.refused_no_photo', { coupleId });
    throw new AppError('Add your first photo to finish your profile.', 400, 'PHOTO_REQUIRED');
  }
  // City is mandatory in the product (Arfam: "they must fill city") and the
  // current app enforces it client-side before this call. WARN-only here
  // because store builds older than the mandatory-city cycle can still
  // complete without one — a hard 400 would strand those users at the final
  // step. FLIP TO STRICT (join the check above) once 1.0.1(8)+ is the fleet
  // floor — tracked in workspace todo.md.
  const hasCity = !!stored?.locationCity && stored.locationCity !== 'Unknown';
  if (!hasCity) {
    // STRICT since 2026-08-31: the fleet floor is 1.0.4(11)+ and every build
    // in the field collects the city client-side — a missing one is a defect,
    // not a legacy build. Refuse rather than mint an incomplete profile.
    logger.warn(`[CoupleController] completeOnboarding REFUSED for ${coupleId}: no city stored`);
    logAuthEvent('onboarding.refused_no_city', { coupleId });
    throw new AppError('Please add your city to finish your profile.', 400, 'CITY_REQUIRED');
  }

  // Gender follows the same fleet contract as city: the current app makes it
  // mandatory client-side; here it stays warn-only until the fleet floor
  // rises past the gender-collecting build. Same strict-flip note as above.
  const partners = await prisma.user.findMany({
    where: { coupleId: coupleId! },
    select: { gender: true },
  });
  if (partners.some((p) => !p.gender)) {
    // Same strict contract as city ("Prefer not to say" is a first-class answer).
    logger.warn(`[CoupleController] completeOnboarding REFUSED for ${coupleId}: gender missing for a partner`);
    logAuthEvent('onboarding.refused_no_gender', { coupleId });
    throw new AppError('Pick a gender for both of you to finish your profile.', 400, 'GENDER_REQUIRED');
  }

  // 4. The ONE writer of isProfileComplete (also announces to the city).
  await coupleService.markProfileComplete(coupleId!);
  await invalidateCoupleProfile(coupleId!);

  // 5. Under-review wiring (team call): the profile stays pending until BOTH
  // partners have actually opened Sawa. Ping the partner who never has —
  // SMS + WhatsApp through the same abuse-guarded invite path. Fire-and-forget:
  // a messaging failure must never fail onboarding completion.
  try {
    const neverActive = await prisma.user.findFirst({
      where: { coupleId: coupleId!, id: { not: req.user!.userId }, lastActiveAt: null, phone: { not: null } },
      select: { phone: true },
    });
    if (neverActive?.phone) {
      void authService.sendPartnerInvite(neverActive.phone, req.ip).catch(() => {});
      logger.info(`[CoupleController] partner invite queued for couple ${coupleId} (partner not active yet)`);
    }
  } catch (err) {
    logger.warn(`[CoupleController] partner-invite check failed for ${coupleId}: ${(err as Error).message}`);
  }

  // 5. Fetch the final profile to return to the client.
  const couple = await coupleService.getCouple(coupleId!);

  logAuthEvent('onboarding.completed', { coupleId });
  sendSuccess({
    res,
    statusCode: 200,
    message: 'All Onboarding data completed successfully',
    data: { couple }
  });
};

export const createCouple = async (_req: Request, _res: Response) => {
  // Stub for legacy API
};

export const getMyCouple = async (req: Request, res: Response) => {
  const { coupleId, userId } = req.user!;

  // A token without a coupleId used to reach prisma with `undefined` and blow
  // up as a raw 500. It means the session predates the identity repair — an
  // honest 401 sends the app through login, where the resolver fixes the row.
  if (!coupleId) {
    throw new AppError('Session incomplete — please log in again.', 401, 'SESSION_INVALID');
  }

  // Serve from cache when available (invalidated by updateMyCouple, uploadPhotos, etc.)
  const cached = await getCachedCoupleProfile(coupleId!);
  if (cached) {
    sendSuccess({ res, data: { couple: cached, userId } });
    return;
  }

  const couple = await coupleService.getCouple(coupleId!);
  if (!couple) {
    throw new AppError('Couple profile not found', 404);
  }

  // Populate cache for subsequent calls within the TTL.
  await setCachedCoupleProfile(coupleId!, couple);

  sendSuccess({ res, data: { couple, userId } });
};

export const updateMyCouple = async (req: Request, res: Response) => {
  const { coupleId, userId } = req.user!;
  const data = req.body as any;

  const { couple, emailConflict } = await coupleService.updateProfile(coupleId!, data, userId);

  // Update cache immediately so next GET returns fresh data.
  if (couple) await setCachedCoupleProfile(coupleId!, couple);
  else await invalidateCoupleProfile(coupleId!);

  // emailConflict: the profile saved but a requested email was already taken
  // and kept unchanged. The client shows this — a silent skip behind
  // "Profile updated successfully" was invisible data loss.
  sendSuccess({
    res,
    statusCode: 200,
    message: 'Profile updated successfully',
    data: { couple, ...(emailConflict ? { emailConflict: true } : {}) },
  });
};

export const invitePartner = async (_req: Request, _res: Response) => {
  // Stub for partner invite features (if needed later)
};

/**
 * POST /api/v1/couples/subscribe
 *
 * LEGACY endpoint. It only flips the cosmetic `Couple.isSubscribed` flag used by
 * the pre-paywall "activate free access" flow while SUBSCRIPTIONS_ENFORCED is
 * off. It grants NO paid entitlement: real feature gating reads the verified
 * `Subscription` table (populated only via App Store / Play receipt
 * verification at /subscriptions/apple|google/verify), never this flag.
 *
 * Once real enforcement is enabled, this self-serve path is disabled so it can
 * never set a stale/unverified flag — clients must go through IAP verification.
 */
export const subscribe = async (req: Request, res: Response) => {
  if (isEnforced()) {
    throw new AppError(
      'This endpoint is no longer available. Purchase Sawa Prime through the app.',
      410,
    );
  }

  const { coupleId } = req.user!;
  const couple = await coupleService.subscribe(coupleId!);

  sendSuccess({
    res,
    statusCode: 200,
    message: 'Subscription activated. First month is on us!',
    data: { couple },
  });
};

export const getCoupleById = async (req: Request, res: Response) => {
  const { id } = req.params;
  const viewerCoupleId = req.user?.coupleId;
  // Use lightweight summary — public profile view doesn't need communityMembers or answers
  const couple = await coupleService.getCoupleSummary(id);
  if (!couple) {
    throw new AppError('Couple profile not found', 404);
  }
  // Pending profiles are invisible (Arfam 2026-09-01): a share link or a
  // stale card must not leak an unreviewed profile. The couple still sees
  // itself, and an already-connected couple keeps seeing who it matched.
  const isOwn = !!viewerCoupleId && couple.coupleId === viewerCoupleId;
  if (couple.verificationStatus !== 'verified' && !isOwn) {
    const connected = await matchService.areConnected(viewerCoupleId ?? '', couple.coupleId);
    if (!connected) {
      throw new AppError('Couple profile not found', 404);
    }
  }
  sendSuccess({ res, data: { couple } });
};

export const deleteMyAccount = async (req: Request, res: Response): Promise<void> => {
   const { coupleId } = req.user!;
   await coupleService.deleteMyCouple(coupleId!);
   sendSuccess({ res, statusCode: 200, message: 'Account deleted successfully' });
};

/**
 * The rejected-account popup's "Continue" button. The only endpoint a
 * rejected couple can reach (whitelisted in the authenticate middleware).
 * Completes the two-phase rejection by deleting the account.
 */
export const acknowledgeRejection = async (req: Request, res: Response): Promise<void> => {
   const { coupleId } = req.user!;
   await coupleService.acknowledgeRejection(coupleId!);
   sendSuccess({ res, statusCode: 200, message: 'Rejection acknowledged — account deleted' });
};
 
export const getBlockList = async (req: Request, res: Response): Promise<void> => {
   const { coupleMongoId } = req.user!;
   const blocked = await coupleService.getBlockedCouples(coupleMongoId ?? req.user!.coupleId!);
   sendSuccess({ res, statusCode: 200, data: { blocked } });
};
 
export const blockCouple = async (req: Request, res: Response): Promise<void> => {
   const { coupleMongoId } = req.user!;
   const { targetCoupleId } = req.body; // target couple's MONGO _id
   await coupleService.blockCouple(coupleMongoId ?? req.user!.coupleId!, targetCoupleId);
   sendSuccess({ res, statusCode: 200, message: 'Couple blocked' });
};
 
export const unblockCouple = async (req: Request, res: Response): Promise<void> => {
   const { coupleMongoId } = req.user!;
   const { targetCoupleId } = req.body; // target couple's MONGO _id
   await coupleService.unblockCouple(coupleMongoId ?? req.user!.coupleId!, targetCoupleId);
   sendSuccess({ res, statusCode: 200, message: 'Couple unblocked' });
};

export const getBlockedCommunities = async (req: Request, res: Response): Promise<void> => {
   const { coupleMongoId } = req.user!;
   const communities = await coupleService.getBlockedCommunities(coupleMongoId!);
   sendSuccess({ res, statusCode: 200, data: { communities } });
};

export const unblockCommunity = async (req: Request, res: Response): Promise<void> => {
   const { coupleMongoId } = req.user!;
   const { communityId } = req.body;
   await coupleService.unblockCommunity(coupleMongoId!, communityId);
   sendSuccess({ res, statusCode: 200, message: 'Community unblocked' });
};
