import crypto from 'crypto';
import { logger } from './logger';

/**
 * Structured auth-funnel events — the single trail that answers "what
 * happened to this account" (the audit's observability finding: field
 * reports were undiagnosable because the funnel logged nothing).
 * Phones never appear in logs (RULES §3): a short salted-less SHA-256
 * prefix is stable per number, joinable across events, and irreversible.
 */
export type AuthFunnelEvent =
  | 'signup.otp_sent'
  | 'signup.blocked_exists'
  | 'signup.verified'
  | 'signup.invalid_otp'
  | 'login.otp_sent'
  | 'login.bypass'
  | 'login.verified'
  | 'login.invalid_otp'
  | 'login.user_not_found'
  | 'login.couple_not_found'
  | 'onboarding.completed'
  | 'onboarding.refused_incomplete'
  | 'onboarding.refused_no_city'
  | 'onboarding.refused_no_gender'
  | 'onboarding.refused_no_photo';

export const phoneHash = (phone: string): string =>
  crypto.createHash('sha256').update(phone.replace(/\D/g, '')).digest('hex').slice(0, 12);

export function logAuthEvent(
  event: AuthFunnelEvent,
  fields: { phone?: string; coupleId?: string | null; detail?: string } = {},
): void {
  const parts = [`[auth-funnel] ${event}`];
  if (fields.phone) parts.push(`ph=${phoneHash(fields.phone)}`);
  if (fields.coupleId) parts.push(`couple=${fields.coupleId}`);
  if (fields.detail) parts.push(fields.detail);
  logger.info(parts.join(' '));
}
