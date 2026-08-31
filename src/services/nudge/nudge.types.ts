/**
 * Shared types for the Nudge Layer. Kept dependency-free so the pure policy
 * and copy modules stay unit-testable without Prisma or the network.
 */

export type NudgeLocale = 'en' | 'hi' | 'kn' | 'mr';

/** Why a recipient did NOT get a WhatsApp for an event. Stored on the delivery row. */
export type SuppressReason =
  | 'excluded'      // family never goes to WhatsApp (chat, cycle)
  | 'disabled'      // master switch off / no provider configured
  | 'no_template'   // no enabled template for the family (any locale)
  | 'no_phone'
  | 'optout'
  | 'muted'         // recipient muted this family
  | 'online'        // holding a live socket in the couple room right now
  | 'active'        // API activity within the grace window
  | 'cooldown'      // same family sent to them too recently
  | 'cap'           // recipient's daily cap reached
  | 'global_cap'    // platform daily spend cap reached
  | 'opened_app';   // escalation cancelled: they opened the app before the delayed send

export type PolicyDecision =
  | { send: true; scheduledAt: Date }
  | { send: false; reason: SuppressReason };

export interface PolicyRecipient {
  userId: string;
  phone: string | null;
  locale: string | null;
  hasPushToken: boolean;
  lastActiveAt: Date | null;
  isOnline: boolean;
  whatsappOptIn: boolean;
  mutedFamilies: string[];
  /** WhatsApp deliveries already sent or queued to them in the current UTC day. */
  sentToday: number;
  /** Most recent WhatsApp send of this family to them. */
  lastFamilySentAt: Date | null;
}

export interface PolicyConfig {
  family: string;
  channelEnabled: boolean;
  hasTemplate: boolean;
  familyExcluded: boolean;
  activityInsensitive: boolean;
  dailyCap: number;
  familyCooldownMin: number;
  activeGraceSec: number;
  /** Minutes to hold a WhatsApp when the recipient also has push (0 = immediate). */
  whatsappDelayMin: number;
  globalCapReached: boolean;
}

/**
 * The context the copy renderer draws template variables from. Built from the
 * push payload's i18nParams + the recipient row; every field optional so a
 * template can only ever render what the moment actually carries.
 */
export interface CopyContext {
  /** Actor's first name (the partner who did the thing). */
  name?: string;
  /** Actor gender token, product convention: primary 'm', partner 'f'. */
  g?: 'm' | 'f';
  feeling?: string;
  note?: string;
  game?: string;
  /** Couple display name for couple-to-couple moments ("Rahul & Aarushi"). */
  profileName?: string;
  /** Recipient's own first name. */
  recipientName?: string;
  /** Recipient's partner's first name (journeys address the pair). */
  partnerName?: string;
  city?: string;
  community?: string;
  suggestion?: string;
  /** Free text (generic template): rendered title + body of the push. */
  text?: string;
  link?: string;
  /** Journey step index or similar, for dedupe/reporting only. */
  step?: string;
}

/** What the recipient lands on when they tap the link. Mirrors the mobile tap router payload. */
export type LinkTarget = Record<string, string> & { subtype: string };

export interface SendTemplateInput {
  /** E.164 digits without '+', e.g. 919876543210. */
  toDigits: string;
  templateName: string;
  /** Positional variables {{1}}..{{n}}. */
  variables: string[];
  /** Provider-side campaign label (WATI broadcast_name). */
  label: string;
  locale?: string;
}

export interface SendResult {
  ok: boolean;
  providerMessageId?: string;
  error?: string;
}

export interface WhatsAppProvider {
  readonly name: 'wati' | 'twilio';
  sendTemplate(input: SendTemplateInput): Promise<SendResult>;
  /** Free-form text, only deliverable inside an open 24h session (replies to STOP/START). */
  sendText(toDigits: string, text: string): Promise<SendResult>;
}
