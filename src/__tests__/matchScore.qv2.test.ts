import { scoreCouples, generateInsights, type ScoringCouple } from '../services/matchScore';

/**
 * v2 questionnaire scoring (2026-09-02): forced-choice pairs, last-month
 * behavior, hosting complementarity, and the table/drinks compatibility
 * matrices. Pure functions — no mocks. These tests pin the DESIGN, not the
 * exact numbers: crossed hosts beat matched hosts, compatible tables beat
 * clashing ones, shared behavior raises a score, legacy profiles still work,
 * and the whole thing stays symmetric and deterministic.
 */
const couple = (
  answers: Array<{ questionId: string; selectedOptionIds: string[] }>,
  over: Partial<ScoringCouple> = {},
): ScoringCouple => ({
  locationCity: 'Bangalore',
  activities: ['Restaurants', 'Board games'],
  socialVibes: [],
  matchCriteria: [],
  answers,
  ...over,
});

const BASE = [
  { questionId: 'q1', selectedOptionIds: ['q1-career'] },
  { questionId: 'q9', selectedOptionIds: ['q9-satnight', 'q9-sunbrunch'] },
];

describe('hosting complementarity (q7a)', () => {
  const host = couple([...BASE, { questionId: 'q7a', selectedOptionIds: ['q7a-host'] }]);
  const guest = couple([...BASE, { questionId: 'q7a', selectedOptionIds: ['q7a-guest'] }]);
  const host2 = couple([...BASE, { questionId: 'q7a', selectedOptionIds: ['q7a-host'] }]);

  it('scores a host+guest pair above two hosts', () => {
    expect(scoreCouples(host, guest)).toBeGreaterThan(scoreCouples(host, host2));
  });

  it('leads the insights with the crossed-hosting line, directionally correct', () => {
    expect(generateInsights(host, guest)[0]).toBe('You love hosting, they love being hosted');
    expect(generateInsights(guest, host)[0]).toBe('They love hosting, you love being hosted');
  });
});

describe('table compatibility (q10)', () => {
  const veg = couple([...BASE, { questionId: 'q10', selectedOptionIds: ['q10-veg'] }]);
  const nonveg = couple([...BASE, { questionId: 'q10', selectedOptionIds: ['q10-nonveg'] }]);
  const all = couple([...BASE, { questionId: 'q10', selectedOptionIds: ['q10-all'] }]);

  it('everything-goes hosts a veg table better than non-veg does', () => {
    expect(scoreCouples(veg, all)).toBeGreaterThan(scoreCouples(veg, nonveg));
  });

  it('a clashing table lowers but never zeroes the score', () => {
    expect(scoreCouples(veg, nonveg)).toBeGreaterThanOrEqual(55);
  });

  it('two vegetarian tables earn the insight; everything-goes stays quiet', () => {
    const veg2 = couple([{ questionId: 'q10', selectedOptionIds: ['q10-veg'] }]);
    expect(generateInsights(veg, veg2)).toContain('Both tables are vegetarian');
    const all2 = couple([{ questionId: 'q10', selectedOptionIds: ['q10-all'] }]);
    expect(generateInsights(all, all2)).not.toContain('Both tables are vegetarian');
  });
});

describe('last-month behavior (q8)', () => {
  const acts = (ids: string[]) => couple([{ questionId: 'q8', selectedOptionIds: ids }]);

  it('shared real behavior beats disjoint behavior', () => {
    const a = acts(['q8-hosted', 'q8-newspot']);
    const same = acts(['q8-hosted', 'q8-newspot']);
    const other = acts(['q8-daytrip', 'q8-show']);
    expect(scoreCouples(a, same)).toBeGreaterThan(scoreCouples(a, other));
  });

  it('mentions the shared act, but never celebrates a shared quiet month', () => {
    const a = acts(['q8-hosted', 'q8-quiet']);
    const b = acts(['q8-hosted', 'q8-quiet']);
    const lines = generateInsights(a, b);
    expect(lines).toContain('Had people over - both of you, just last month');
    expect(lines.join(' ')).not.toMatch(/quiet/i);
  });
});

describe('shared free windows (q9)', () => {
  it('says when both couples are actually free', () => {
    const a = couple([{ questionId: 'q9', selectedOptionIds: ['q9-sunbrunch'] }]);
    const b = couple([{ questionId: 'q9', selectedOptionIds: ['q9-sunbrunch', 'q9-frinight'] }]);
    expect(generateInsights(a, b)).toContain('Same free window - sunday brunch');
  });
});

describe('backwards compatibility and invariants', () => {
  const legacyA = couple([
    { questionId: 'q1', selectedOptionIds: ['q1-family'] },
    { questionId: 'q3', selectedOptionIds: ['q3-restaurants', 'q3-trips'] },
    { questionId: 'q4', selectedOptionIds: ['q4-once-month'] },
  ]);
  const legacyB = couple([
    { questionId: 'q1', selectedOptionIds: ['q1-family'] },
    { questionId: 'q3', selectedOptionIds: ['q3-restaurants'] },
    { questionId: 'q4', selectedOptionIds: ['q4-once-month'] },
  ]);
  const v2 = couple([
    ...BASE,
    { questionId: 'q7a', selectedOptionIds: ['q7a-host'] },
    { questionId: 'q8', selectedOptionIds: ['q8-hosted'] },
    { questionId: 'q10', selectedOptionIds: ['q10-all'] },
    { questionId: 'q11', selectedOptionIds: ['q11-some'] },
  ]);

  it('legacy-only couples still score sensibly (absent dimensions renormalize)', () => {
    const score = scoreCouples(legacyA, legacyB);
    expect(score).toBeGreaterThan(55);
    expect(score).toBeLessThanOrEqual(100);
  });

  it('a legacy couple against a v2 couple never crashes and stays in range', () => {
    const score = scoreCouples(legacyA, v2);
    expect(score).toBeGreaterThanOrEqual(55);
    expect(score).toBeLessThanOrEqual(100);
  });

  it('stays symmetric and deterministic across the new dimensions', () => {
    expect(scoreCouples(v2, legacyA)).toBe(scoreCouples(legacyA, v2));
    expect(scoreCouples(v2, v2)).toBe(scoreCouples(v2, v2));
  });
});
