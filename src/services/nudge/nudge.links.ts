import crypto from 'crypto';
import { env } from '../../config/env';
import { NUDGE_LINK_TOKEN_BYTES } from '../../constants/nudge';
import type { LinkTarget } from './nudge.types';

/**
 * Return-path links.
 *
 * Every WhatsApp carries ONE link: https://<api host>/l/<token>. The token is
 * the delivery row's id in the world (unguessable, 128 bits), so a tap is
 * attributable without cookies or query strings. Resolution:
 *   • app installed → the OS opens Sawa on the URL (App Link / Universal Link
 *     path /l/*), the app calls GET /api/v1/nudges/links/:token and routes
 *     the returned target through Service/notificationRouting.ts.
 *   • not installed → the browser hits GET /l/:token, the click is recorded,
 *     the store page renders, and the intent waits for the first login
 *     (GET /api/v1/nudges/pending-intent).
 *
 * Targets speak the mobile tap router's vocabulary (`subtype` + ids) so the
 * three tap surfaces (push, in-app row, WhatsApp link) can never disagree.
 */

export const newLinkToken = (): string =>
  crypto.randomBytes(NUDGE_LINK_TOKEN_BYTES).toString('base64url');

export const isLinkToken = (v: unknown): v is string =>
  typeof v === 'string' && /^[A-Za-z0-9_-]{16,64}$/.test(v);

export const publicBaseUrl = (): string =>
  (env.APP_URL || 'https://api.sawaliving.in').replace(/\/+$/, '');

export const buildLinkUrl = (token: string): string => `${publicBaseUrl()}/l/${token}`;

/** Keys of the push payload worth carrying into a link target (whitelist, RULES S8). */
const TARGET_KEYS = [
  'type',
  'subtype',
  'kind',
  'navigate',
  'matchId',
  'communityId',
  'coupleId',
  'gameId',
  'noteId',
  'notificationId',
  'isPending',
] as const;

/**
 * Build the tap target for a family from the originating push data. Journeys
 * and lifecycle families have no push; they land on the surface named here.
 */
export function targetFor(family: string, data: Record<string, unknown> | undefined): LinkTarget {
  const d = data ?? {};
  const out: Record<string, string> = {};
  for (const k of TARGET_KEYS) {
    const v = d[k];
    if (v === undefined || v === null) continue;
    const s = typeof v === 'string' ? v : typeof v === 'boolean' || typeof v === 'number' ? String(v) : '';
    if (s && /^[A-Za-z0-9_-]{1,64}$/.test(s)) out[k] = s;
  }
  if (!out.subtype) {
    switch (family) {
      case 'welcome':
      case 'partner_invite':
      case 'partner_waiting':
        out.subtype = 'home';
        out.navigate = 'Home';
        break;
      case 'first_mood':
      case 'sunday_checkin':
        out.subtype = 'us_mood';
        out.navigate = 'UsSpace';
        break;
      case 'first_game':
      case 'quiet_couple':
        out.subtype = 'us_game_challenge';
        out.navigate = 'UsSpace';
        break;
      case 'friday_plan':
        out.subtype = 'us_date_plan';
        out.navigate = 'UsSpace';
        break;
      case 'first_circle':
        out.subtype = 'community';
        out.navigate = 'Communities';
        break;
      default:
        out.subtype = out.type || family;
    }
  }
  return out as LinkTarget;
}

/** sawa://n/<subtype>?k=v… for the browser fallback page's "Open in Sawa" button. */
export function schemeUrlFor(target: LinkTarget): string {
  const { subtype, ...rest } = target;
  const qs = new URLSearchParams(rest).toString();
  return `sawa://n/${encodeURIComponent(subtype)}${qs ? `?${qs}` : ''}`;
}
