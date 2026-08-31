import { Request, Response } from 'express';
import { z } from 'zod';
import { sendSuccess } from '../utils/response';
import { AppError } from '../utils/AppError';
import { validate } from '../middleware/validate';
import { getPreferences, updatePreferences } from '../services/nudge/nudge.preferences';
import { resolveLinkForCouple, takePendingIntent } from '../services/nudge/nudge.intents';
import type { NudgePreferencesDto, NudgeLinkTargetDto } from '../contracts/nudge';

/**
 * /api/v1/nudges — the app-facing half of the Nudge Layer: consent, and the
 * two ways a WhatsApp tap finds its way to the right screen.
 */

const updatePrefsBody = z.object({
  whatsappOptIn: z.boolean().optional(),
  mutedFamilies: z.array(z.string().regex(/^[a-z_]{1,40}$/)).max(32).optional(),
});
export const validateUpdatePrefs = validate(updatePrefsBody);

const linkParams = z.object({ token: z.string().regex(/^[A-Za-z0-9_-]{16,64}$/) });
export const validateLinkParams = validate(linkParams, 'params');

export const getMyPreferences = async (req: Request, res: Response): Promise<void> => {
  const prefs: NudgePreferencesDto = await getPreferences(req.user!.userId);
  sendSuccess({ res, data: { preferences: prefs } });
};

export const updateMyPreferences = async (req: Request, res: Response): Promise<void> => {
  const body = req.body as z.infer<typeof updatePrefsBody>;
  if (body.whatsappOptIn === undefined && body.mutedFamilies === undefined) {
    throw new AppError('Nothing to update', 400, 'VALIDATION');
  }
  const prefs: NudgePreferencesDto = await updatePreferences(req.user!.userId, body, 'app');
  sendSuccess({ res, data: { preferences: prefs }, message: 'Preferences saved' });
};

/** The app opened on a nudge link; hand it the target (couple-scoped). */
export const resolveLink = async (req: Request, res: Response): Promise<void> => {
  const { coupleId } = req.user!;
  const target: NudgeLinkTargetDto | null = coupleId
    ? await resolveLinkForCouple(String(req.params.token), coupleId)
    : null;
  if (!target) throw new AppError('This link has expired', 404, 'LINK_NOT_FOUND');
  sendSuccess({ res, data: { target } });
};

/** First login after a tap on a phone that had no app: replay the intent once. */
export const pendingIntent = async (req: Request, res: Response): Promise<void> => {
  const target: NudgeLinkTargetDto | null = await takePendingIntent(req.user!.userId);
  sendSuccess({ res, data: { target } });
};
