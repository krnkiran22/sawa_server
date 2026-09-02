import type { CopyContext } from './nudge.types';
import { NUDGE_VARIABLE_TEXT_MAX } from '../../constants/nudge';
import { localizeMoodLabel } from '../../i18n/notif';

/**
 * WhatsApp template variables.
 *
 * A template's approved body is fixed at the provider (Meta reviews it); the
 * only thing we send per message is the ordered list of variable values. Each
 * template row carries `variables: string[]` naming which resolver fills
 * {{1}}, {{2}}, ... so admin can point a family at a differently-worded
 * template without a deploy. Copy for the seeded templates lives in
 * SAWA_Master_Reference.md §11.7 and is mirrored in nudge.templates.ts.
 *
 * Gender follows the app convention (i18n/notif.ts): primary partner 'm',
 * partner 'f'. Hindi/Kannada/Marathi templates are written gender-neutral, so
 * the pronoun resolvers only matter for English bodies.
 */

type Resolver = (ctx: CopyContext, locale: string) => string;

const first = (s?: string): string => (s || '').trim().split(/\s+/)[0] || '';

const clip = (s?: string): string => {
  const t = (s || '').replace(/\s+/g, ' ').trim();
  return t.length > NUDGE_VARIABLE_TEXT_MAX ? `${t.slice(0, NUDGE_VARIABLE_TEXT_MAX - 1)}…` : t;
};

const RESOLVERS: Record<string, Resolver> = {
  name: (c) => first(c.name) || 'Your partner',
  recipientName: (c) => first(c.recipientName) || 'there',
  partnerName: (c) => first(c.partnerName) || 'your partner',
  profileName: (c) => (c.profileName || 'A couple').trim(),
  // "her" / "his"
  poss: (c) => (c.g === 'f' ? 'her' : 'his'),
  // "She's" / "He's"
  subjBe: (c) => (c.g === 'f' ? "She's" : "He's"),
  feeling: (c, loc) => (localizeMoodLabel(c.feeling, loc) || 'something').toLowerCase(),
  note: (c) => clip(c.note),
  game: (c) => (c.game || 'a game').trim(),
  city: (c) => (c.city || 'your city').trim(),
  community: (c) => (c.community || 'a circle').trim(),
  suggestion: (c) => (c.suggestion || '').trim(),
  text: (c) => clip(c.text),
  link: (c) => c.link || '',
  // For templates whose link rides a dynamic-URL BUTTON (base
  // https://api.sawaliving.in/l/ + suffix): only the token travels. Always
  // place it LAST in `variables`; the body then uses one variable fewer.
  linkToken: (c) => {
    const l = c.link || '';
    const i = l.indexOf('/l/');
    return i >= 0 ? l.slice(i + 3) : '';
  },
};

/** True when every variable id is known, so admin typos surface before approval. */
export const knownVariable = (id: string): boolean => Object.prototype.hasOwnProperty.call(RESOLVERS, id);

export const VARIABLE_IDS = Object.keys(RESOLVERS);

/**
 * Fill a template's ordered variables from the moment's context. Unknown ids
 * render as '' rather than throwing: a half-rendered nudge is recoverable, a
 * crashed worker loop is not.
 */
export function renderVariables(variables: string[], ctx: CopyContext, locale: string): string[] {
  return variables.map((id) => {
    const r = RESOLVERS[id];
    return r ? r(ctx, locale) : '';
  });
}

/**
 * Feeling labels the app sends are English keys ("Calm"). The English body
 * lowercases them ("She's feeling calm"); other locales get the translated
 * word as-is. Exposed so tests can pin the sentence shape.
 */
export function moodSentenceParts(ctx: CopyContext, locale: string): { poss: string; subjBe: string; feeling: string } {
  return {
    poss: RESOLVERS.poss(ctx, locale),
    subjBe: RESOLVERS.subjBe(ctx, locale),
    feeling: RESOLVERS.feeling(ctx, locale),
  };
}
