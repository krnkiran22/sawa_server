import { renderVariables, moodSentenceParts, knownVariable } from '../services/nudge/nudge.copy';
import { TEMPLATE_SEEDS } from '../services/nudge/nudge.templates';
import { familyFromPushData, HARD_EXCLUDED_FAMILIES } from '../constants/nudge';
import { targetFor, schemeUrlFor } from '../services/nudge/nudge.links';

jest.mock('../lib/prisma', () => ({ prisma: {} }));

describe('nudge copy — variables', () => {
  it("renders Arfam's mood line: Neha just shared her mood. She's feeling calm", () => {
    const seed = TEMPLATE_SEEDS.find((s) => s.family === 'us_mood')!;
    const vars = renderVariables(seed.variables, { name: 'Neha Sharma', g: 'f', feeling: 'Calm', link: 'https://api.sawaliving.in/l/abc' }, 'en');
    expect(vars).toEqual(['Neha', 'her', "She's", 'calm', 'https://api.sawaliving.in/l/abc']);
    const body = seed.bodyPreview.replace(/\{\{(\d)\}\}/g, (_m, i) => vars[Number(i) - 1]);
    expect(body).toBe("Neha just shared her mood. She's feeling calm 💛 Want to share how you're feeling? https://api.sawaliving.in/l/abc");
    expect(body).not.toContain('—');
  });

  it('male actor takes his / He\'s', () => {
    expect(moodSentenceParts({ g: 'm', feeling: 'Happy' }, 'en')).toEqual({ poss: 'his', subjBe: "He's", feeling: 'happy' });
  });

  it('localizes the feeling for other locales and clips long notes', () => {
    expect(renderVariables(['feeling'], { feeling: 'Calm' }, 'hi')).toEqual(['शांत']);
    const long = 'x'.repeat(200);
    const [note] = renderVariables(['note'], { note: long }, 'en');
    expect(note.length).toBeLessThanOrEqual(120);
    expect(note.endsWith('…')).toBe(true);
  });

  it('every seeded template uses only known variable ids and no em dashes', () => {
    for (const s of TEMPLATE_SEEDS) {
      for (const v of s.variables) expect(knownVariable(v)).toBe(true);
      expect(s.bodyPreview).not.toContain('—');
      // Every {{n}} in the body has a variable behind it.
      const max = Math.max(0, ...Array.from(s.bodyPreview.matchAll(/\{\{(\d+)\}\}/g)).map((m) => Number(m[1])));
      expect(max).toBe(s.variables.length);
    }
  });
});

describe('nudge families — from push payloads', () => {
  it('maps the historical us_feeling push name onto us_mood', () => {
    expect(familyFromPushData({ type: 'us_feeling', subtype: 'us_mood' })).toBe('us_mood');
    expect(familyFromPushData({ type: 'us_feeling' })).toBe('us_mood');
  });
  it('splits match into pending (hello) vs connected', () => {
    expect(familyFromPushData({ type: 'match', isPending: true })).toBe('match_pending');
    expect(familyFromPushData({ type: 'match', isPending: 'false' })).toBe('match_connected');
  });
  it('chat and cycle are hard-excluded', () => {
    expect(HARD_EXCLUDED_FAMILIES.has(familyFromPushData({ type: 'message', matchId: 'm1' }))).toBe(true);
    expect(HARD_EXCLUDED_FAMILIES.has(familyFromPushData({ type: 'us_cycle', subtype: 'us_cycle' }))).toBe(true);
    expect(HARD_EXCLUDED_FAMILIES.has(familyFromPushData({ subtype: 'us_partner_message' }))).toBe(true);
  });
  it('unknown subtypes pass through so admin can enable them by template', () => {
    expect(familyFromPushData({ subtype: 'us_date_plan' })).toBe('us_date_plan');
    expect(familyFromPushData(undefined)).toBe('unknown');
  });
});

describe('nudge links — targets', () => {
  it('whitelists tap-router keys and builds a scheme url', () => {
    const t = targetFor('us_fridge_note', { subtype: 'us_fridge_note', noteId: 'n_1', navigate: 'UsSpace', senderPhoto: 'https://x/y.jpg', i18nParams: { a: 1 } });
    expect(t).toEqual({ subtype: 'us_fridge_note', noteId: 'n_1', navigate: 'UsSpace' });
    // Key order follows the whitelist (navigate before noteId), stable across runs.
    expect(schemeUrlFor(t)).toBe('sawa://n/us_fridge_note?navigate=UsSpace&noteId=n_1');
  });
  it('lifecycle families land on a sensible surface', () => {
    expect(targetFor('welcome', undefined).subtype).toBe('home');
    expect(targetFor('friday_plan', undefined)).toEqual({ subtype: 'us_date_plan', navigate: 'UsSpace' });
  });
});
