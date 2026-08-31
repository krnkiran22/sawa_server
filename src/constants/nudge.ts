/**
 * Nudge Layer vocabulary (services/nudge/*).
 *
 * A "family" is the product-level kind of moment a nudge is about. It is the
 * key every other table hangs off: templates are per family+locale, the
 * cooldown is per family, admin toggles are per family, journeys emit a
 * family. Families are derived from the existing push payload vocabulary
 * (`data.subtype` / `data.type`, see i18n/notif.ts) so no call site had to
 * learn a second name for the same event (RULES §7 DRY).
 */

// ─── Families that are never sent over WhatsApp, whatever admin enables ───────
// Chat is high-frequency and already excluded at env level; cycle/health data
// never leaves the app (M5 privacy decision, changelog 2026-08-21).
export const HARD_EXCLUDED_FAMILIES: ReadonlySet<string> = new Set([
  'chat',
  'message',
  'us_partner_message',
  'us_cycle',
  'cycle',
  'us_cycle_shared',
  'subscription',
  'test_push',
]);

// ─── Families that must reach someone who is "active right now" ───────────────
// A welcome lands seconds after signup, an invite reminder targets someone who
// has never opened the app; the online/active gate must not eat them.
export const ACTIVITY_INSENSITIVE_FAMILIES: ReadonlySet<string> = new Set([
  'welcome',
  'partner_invite',
  'partner_waiting',
]);

// ─── Families where the actor is also a recipient ─────────────────────────────
export const INCLUDE_ACTOR_FAMILIES: ReadonlySet<string> = new Set(['welcome']);

// ─── Phase-0 WhatsApp-native families (Arfam, 2026-08-31) ─────────────────────
// Everything else becomes WhatsApp-capable the moment admin adds + enables a
// template row for it; nothing here is a hard gate beyond seeding.
export const PHASE0_FAMILIES = [
  'welcome',
  'partner_invite',
  'partner_waiting',
  'us_mood',
  'us_fridge_note',
  'us_game_challenge',
  'match_pending',
] as const;

/** Push `type` values that ARE (or alias) a family. */
const FAMILY_BY_TYPE: Record<string, string> = {
  us_feeling: 'us_mood',
  us_mood: 'us_mood',
  us_fridge_note: 'us_fridge_note',
  us_fridge_ack: 'us_fridge_ack',
  us_game_challenge: 'us_game_challenge',
  us_game_result: 'us_game_result',
  us_love: 'us_love',
  us_nudge: 'us_nudge',
  us_ask_feeling: 'us_ask_feeling',
  us_date_plan: 'us_date_plan',
  us_date_reminder: 'us_date_reminder',
  us_date_reminder_soon: 'us_date_reminder',
  us_partner_message: 'us_partner_message',
  us_cycle: 'us_cycle',
  message: 'chat',
  admin: 'admin',
  nearby: 'nearby',
  community: 'community',
  subscription: 'subscription',
};

/**
 * Resolve the family for an existing push payload. `subtype` wins (it is the
 * canonical vocabulary the mobile tap router keys on); the `match` type splits
 * on pending/connected because a hello and an acceptance are different moments.
 */
export function familyFromPushData(data: Record<string, unknown> | undefined): string {
  const d = data ?? {};
  const subtype = typeof d.subtype === 'string' ? d.subtype : '';
  const type = typeof d.type === 'string' ? d.type : '';
  if (d.source === 'test-push') return 'test_push';
  if (type === 'match') {
    return d.isPending === true || d.isPending === 'true' ? 'match_pending' : 'match_connected';
  }
  if (subtype) return FAMILY_BY_TYPE[subtype] ?? subtype;
  if (type) return FAMILY_BY_TYPE[type] ?? type;
  return 'unknown';
}

// ─── Inbound WhatsApp keywords ────────────────────────────────────────────────
// Meta requires STOP to be honoured. Matching is whole-message, case/space
// insensitive, in the four app languages plus the common English variants.
export const STOP_WORDS: ReadonlySet<string> = new Set([
  'stop', 'unsubscribe', 'stop all', 'cancel', 'end', 'quit', 'opt out', 'optout',
  'रोको', 'बंद', 'बंद करो', 'ನಿಲ್ಲಿಸಿ', 'थांबा', 'बंद करा',
]);
export const START_WORDS: ReadonlySet<string> = new Set([
  'start', 'resume', 'unstop', 'subscribe', 'opt in', 'optin', 'yes',
  'शुरू', 'चालू', 'ಪ್ರಾರಂಭಿಸಿ', 'सुरू',
]);

// ─── Timing ───────────────────────────────────────────────────────────────────
/** A recipient action within this window after a nudge counts as its conversion. */
export const NUDGE_CONVERSION_WINDOW_MIN = 30;
/** A clicked link's deferred intent is replayable this long after the click. */
export const NUDGE_INTENT_TTL_HOURS = 24 * 7;
/** Provider status callbacks without a message id match the latest send to that phone within this window. */
export const NUDGE_STATUS_MATCH_HOURS = 48;
/** Outbox rows that keep failing are parked after this many attempts. */
export const NUDGE_MAX_EVENT_ATTEMPTS = 5;
/** Worker cadence. */
export const NUDGE_OUTBOX_TICK_MS = 3_000;
export const NUDGE_DISPATCH_TICK_MS = 5_000;
export const NUDGE_JOURNEY_TICK_MS = 10 * 60 * 1000;
/** Link tokens: 16 random bytes → 22 chars base64url. */
export const NUDGE_LINK_TOKEN_BYTES = 16;
/** Body text cap when a note/message is embedded in a template variable. */
export const NUDGE_VARIABLE_TEXT_MAX = 120;
