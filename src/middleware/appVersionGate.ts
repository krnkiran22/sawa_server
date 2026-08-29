import { Request, Response, NextFunction } from 'express';
import { env } from '../config/env';

/**
 * Force-update contract — in from build ONE of the in-house era, so the fleet
 * can always be moved forward deliberately. (The Railway era's unkillable old
 * builds — hardcoded hosts, warn-only checks waiting on a "fleet floor" —
 * must never happen again.)
 *
 * Every app request carries X-App-Build (Android versionCode / iOS build
 * number, integer) and X-App-Platform. When the platform's MIN_APP_BUILD_* is
 * configured above 0 and the caller's build is older, the request receives
 * 426 UPGRADE REQUIRED with the update URL, and the app shows its blocking
 * gate. Requests WITHOUT the headers (admin panel, curl, web) are never
 * gated — header presence is the opt-in.
 *
 * Raising the floor is an ops action: set MIN_APP_BUILD_ANDROID / _IOS in the
 * env secret and bounce the service.
 */
export const appVersionGate = (req: Request, res: Response, next: NextFunction): void => {
  const rawBuild = req.header('x-app-build');
  const platform = (req.header('x-app-platform') || '').toLowerCase();
  if (!rawBuild || !platform) return next();

  const build = Number(rawBuild);
  if (!Number.isFinite(build) || build <= 0) return next();

  const min = platform === 'ios' ? env.MIN_APP_BUILD_IOS : env.MIN_APP_BUILD_ANDROID;
  if (min > 0 && build < min) {
    res.status(426).json({
      success: false,
      code: 'APP_UPDATE_REQUIRED',
      error: 'This version of Sawa is too old. Update to keep going.',
      updateUrl:
        env.APP_UPDATE_URL ||
        `${(env.APP_URL || 'https://sawa.living').replace(/\/$/, '')}/app`,
    });
    return;
  }
  next();
};
