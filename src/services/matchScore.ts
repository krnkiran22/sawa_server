/**
 * Deterministic couple-to-couple match scoring.
 *
 * Replaces the launch-era placeholder (`Math.random()*20+80` + two hardcoded
 * "insights" shown to every user) with an honest score computed from the data
 * couples actually give us:
 *
 *   • onboarding answers   (q1 life stage, q2 couple personality, q3 favorite
 *                           activities, q4 meeting pace — plus legacy q5/q6)
 *   • activities           (the "what you really enjoy" chips)
 *   • socialVibes          (legacy preference field, often empty)
 *   • matchCriteria        (q5-style labels or the AI-generated paragraph)
 *   • locationCity         (same-city bonus)
 *
 * Everything here is a pure function of its inputs — no I/O, no randomness —
 * so the same two couples always score the same. See scoreCouples() for the
 * weighting and the display floor rationale.
 */

// ─── Vocabulary ───────────────────────────────────────────────────────────────

/**
 * The SCORING vocabulary: option id → the short token used for overlap
 * matching and insight copy. This is deliberately NOT the admin's display
 * map (constants/onboardingLabels): that one carries longer panel labels
 * ("Weekend trips/travel"); this one carries what an insight line can say
 * out loud ("weekend trips") and what ancient title-stored rows contain.
 * Adding a question means adding its ids to BOTH maps.
 */
const OPTION_LABELS: Record<string, string> = {
  // q1 — life stage
  'q1-career': 'Building careers',
  'q1-family': 'Family first',
  'q1-settled': 'Newly settled',
  'q1-living': 'Living it up',
  'q1-growing': 'Growing together',
  'q1-adventure': 'Always exploring',
  // q2 — couple personality
  'q2-hosts': 'The Hosts',
  'q2-yes-couple': "The 'yes' couple",
  'q2-yes': "The 'yes' couple",
  'q2-planners': 'The Planners',
  'q2-explorers': 'The Explorers',
  // q3 — favorite activities (short, insight-friendly)
  'q3-dinners-home': 'Dinners at home',
  'q3-dinner': 'Dinner at home',
  'q3-restaurants': 'Exploring restaurants',
  'q3-outdoor': 'Outdoor activities',
  'q3-cultural': 'Cultural events',
  'q3-drinks': 'Casual drinks',
  'q3-trips': 'Weekend trips',
  // q4 — both generations
  'q4-once-month': 'meeting once a month',
  'q4-twice-month': 'meeting twice a month',
  'q4-once-week': 'meeting once a week',
  'q4-when-fits': 'meeting when it fits',
  'q4-similar': 'similar couples',
  'q4-balanced': 'a balanced mix',
  'q4-diverse': 'very different couples',
  // q5/q6 — legacy
  'q5-similar-stage': 'Similar life stage',
  'q5-shared-interests': 'Shared interests',
  'q5-small-groups': 'Small groups',
  'q5-structured-plans': 'Structured plans',
  'q5-clear-boundaries': 'Clear boundaries',
  'q5-weekend-availability': 'Weekend availability',
  'q6-late-night': 'No late nights',
  'q6-large-groups': 'No large groups',
  'q6-alcohol-centric': 'No alcohol focus',
  'q6-last-minute': 'No last-minute plans',
  // ── v2 questionnaire (2026-09-02) ──
  'q7b-plan': 'planning ahead',
  'q7b-spont': 'deciding at 6pm',
  'q7c-late': 'late nights out',
  'q7c-early': 'early starts',
  'q7d-one': 'one couple, long dinner',
  'q7d-full': 'a full table',
  'q7e-usual': 'the usual spot',
  'q7e-new': 'somewhere new every time',
  'q7f-in': 'indoors and games',
  'q7f-out': 'outside and moving',
  'q8-hosted': 'Had people over',
  'q8-newspot': 'Tried a new restaurant',
  'q8-daytrip': 'Took a day trip',
  'q8-games': 'Played games together',
  'q8-active': 'Worked out together',
  'q8-show': 'Caught a show',
  'q8-quiet': 'A quiet month',
  'q9-frinight': 'Friday nights',
  'q9-satday': 'Saturday daytime',
  'q9-satnight': 'Saturday nights',
  'q9-sunbrunch': 'Sunday brunch',
  'q9-weekday': 'Weekday evenings',
};

/**
 * Display titles for q3 (favorite activities) onboarding option ids.
 * This is the feed's display-tag vocabulary — `getDiscoveryFeed` renders a
 * couple card's tags through this exact map, and insights reuse it so the
 * words a user reads in an insight match the tags on the card.
 */
export const Q3_TITLES: Record<string, string> = {
  'q3-dinners-home': 'Dinners at home',
  'q3-dinner': 'Dinner at home',
  'q3-restaurants': 'Exploring restaurants',
  'q3-outdoor': 'Outdoor activities',
  'q3-cultural': 'Cultural events',
  'q3-drinks': 'Casual drinks',
  'q3-trips': 'Weekend trips',
};

/**
 * Canonical labels for every onboarding option id the app has ever shipped
 * (mobile QuestionScreen ids + the legacy ids the AI-bio path maps). Answers
 * are stored as ids; legacy rows may hold titles directly — normalizeToken()
 * resolves both to the same comparable form.
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ScoringAnswer {
  questionId: string;
  selectedOptionIds: string[];
}

/** The slice of a Couple row (+ its onboarding answers) the scorer reads. */
export interface ScoringCouple {
  locationCity?: string | null;
  activities?: string[] | null;
  socialVibes?: string[] | null;
  matchCriteria?: string[] | null;
  answers?: ScoringAnswer[] | null;
}

// ─── Score constants ──────────────────────────────────────────────────────────

/**
 * The warm minimum. Raw similarity is remapped onto [SCORE_FLOOR, 100] instead
 * of being hard-clamped: in a couples app, "12% match" reads as an insult, so
 * zero measured overlap displays as 55 while every real difference still
 * spreads monotonically across 55–100 (remapping preserves ordering, so feed
 * ranking is unaffected by the floor).
 */
export const SCORE_FLOOR = 55;

/**
 * Relative weights of each similarity dimension (sums to 90; the remaining 10
 * points are the same-city bonus). Dimensions where EITHER couple has no data
 * are excluded and the remaining weights are renormalized — absence of data is
 * not disagreement, so an unfilled legacy field never drags a score down.
 *
 *   answers       45 — richest structured signal (life stage, personality,
 *                      activities, meeting pace), present for complete profiles
 *   activities    25 — user-curated "what you really enjoy" chips
 *   socialVibes   10 — legacy field, frequently empty
 *   matchCriteria 10 — q5 labels or AI paragraph; noisy, weighted low
 */
const DIMENSION_WEIGHTS = {
  /** Generic per-question overlap (q1, q7b–q7f, q9, plus every legacy id). */
  answers: 28,
  /** The curated "what you really enjoy" chips. */
  activities: 18,
  /** q8 — what they actually DID last month. Behavior outweighs aspiration. */
  behaviors: 14,
  /** q7a — hosting complementarity: a host needs guests (crossed > matched). */
  hosting: 10,
  /** q10 — table compatibility matrix (veg / non-veg / everything). */
  table: 8,
  /** q11 — drinks comfort matrix. */
  drinks: 6,
  socialVibes: 3,
  matchCriteria: 3,
} as const;

const SIMILARITY_POINTS = 90;

/** Flat bonus when both couples share a (normalized) city. Additive, never
 * renormalized — two couples with nothing in common but a city stay near the
 * floor instead of reading as a perfect match. */
const CITY_BONUS_POINTS = 10;

// ─── Normalization helpers ────────────────────────────────────────────────────

/** Resolve an option id to its label (ids and stored titles converge), then
 * lowercase + collapse whitespace so vocabularies compare cleanly. */
const normalizeToken = (raw: string): string =>
  (OPTION_LABELS[raw] ?? raw).toLowerCase().replace(/\s+/g, ' ').trim();

const toTokenSet = (values?: string[] | null): Set<string> => {
  const set = new Set<string>();
  for (const value of values ?? []) {
    if (typeof value !== 'string') continue;
    const token = normalizeToken(value);
    if (token.length > 0) set.add(token);
  }
  return set;
};

const intersect = (a: Set<string>, b: Set<string>): string[] => {
  const shared: string[] = [];
  for (const token of a) if (b.has(token)) shared.push(token);
  return shared.sort(); // sorted for determinism
};

/** Jaccard similarity |A∩B| / |A∪B| over normalized token sets. */
const jaccard = (a: Set<string>, b: Set<string>): number => {
  if (a.size === 0 || b.size === 0) return 0;
  const sharedCount = intersect(a, b).length;
  const unionCount = a.size + b.size - sharedCount;
  return unionCount === 0 ? 0 : sharedCount / unionCount;
};

/**
 * Question ids scored by their OWN dimension below — excluded from the
 * generic per-question average so their weights are explicit and tunable.
 */
const SPECIAL_QUESTIONS = new Set(['q7a', 'q8', 'q10', 'q11']);

/** Raw (un-labeled) option ids for one question — the matrix dimensions
 *  compare ids exactly, not display tokens. */
const rawOptionIds = (answers: ScoringAnswer[] | null | undefined, questionId: string): string[] => {
  const row = (answers ?? []).find((a) => a?.questionId === questionId);
  return row?.selectedOptionIds?.filter((id) => typeof id === 'string') ?? [];
};

/** Pairwise compatibility matrices — NOT identity: a veg table and an
 *  everything-goes table host each other fine; veg and non-veg can still
 *  meet out (0.35, never zero). */
const TABLE_COMPAT: Record<string, Record<string, number>> = {
  'q10-veg': { 'q10-veg': 1, 'q10-all': 0.9, 'q10-nonveg': 0.35 },
  'q10-nonveg': { 'q10-nonveg': 1, 'q10-all': 0.9, 'q10-veg': 0.35 },
  'q10-all': { 'q10-all': 1, 'q10-veg': 0.9, 'q10-nonveg': 0.9 },
};
const DRINKS_COMPAT: Record<string, Record<string, number>> = {
  'q11-yes': { 'q11-yes': 1, 'q11-some': 0.8, 'q11-no': 0.4 },
  'q11-some': { 'q11-yes': 0.8, 'q11-some': 1, 'q11-no': 0.8 },
  'q11-no': { 'q11-yes': 0.4, 'q11-some': 0.8, 'q11-no': 1 },
};
/** Two host-couples both wait for an invite; a host and a guest are a table.
 *  Matched is still fine (they can meet out), crossed is the fit. */
const HOSTING_CROSSED = 1;
const HOSTING_MATCHED = 0.55;

const matrixSimilarity = (
  mine: ScoringAnswer[] | null | undefined,
  theirs: ScoringAnswer[] | null | undefined,
  questionId: string,
  matrix: Record<string, Record<string, number>>,
): number | null => {
  const a = rawOptionIds(mine, questionId)[0];
  const b = rawOptionIds(theirs, questionId)[0];
  if (!a || !b) return null;
  return matrix[a]?.[b] ?? null;
};

const hostingSimilarity = (
  mine: ScoringAnswer[] | null | undefined,
  theirs: ScoringAnswer[] | null | undefined,
): number | null => {
  const a = rawOptionIds(mine, 'q7a')[0];
  const b = rawOptionIds(theirs, 'q7a')[0];
  if (!a || !b) return null;
  return a === b ? HOSTING_MATCHED : HOSTING_CROSSED;
};

/** q8 overlap — what both couples actually did last month (Jaccard on ids;
 *  a shared quiet month counts too: honesty matching honesty). */
const behaviorsSimilarity = (
  mine: ScoringAnswer[] | null | undefined,
  theirs: ScoringAnswer[] | null | undefined,
): number | null => {
  const a = new Set(rawOptionIds(mine, 'q8'));
  const b = new Set(rawOptionIds(theirs, 'q8'));
  if (a.size === 0 || b.size === 0) return null;
  let shared = 0;
  for (const id of a) if (b.has(id)) shared += 1;
  const union = a.size + b.size - shared;
  return union === 0 ? 0 : shared / union;
};

const answersByQuestion = (answers?: ScoringAnswer[] | null): Map<string, Set<string>> => {
  const map = new Map<string, Set<string>>();
  for (const answer of answers ?? []) {
    if (!answer?.questionId) continue;
    if (SPECIAL_QUESTIONS.has(answer.questionId)) continue; // own dimensions
    const set = toTokenSet(answer.selectedOptionIds);
    if (set.size > 0) map.set(answer.questionId, set);
  }
  return map;
};

/**
 * Per-question Jaccard averaged across the questions BOTH couples answered.
 * Returns null when they share no answered questions (dimension absent).
 */
const answersSimilarity = (mine: ScoringCouple, theirs: ScoringCouple): number | null => {
  const mineByQ = answersByQuestion(mine.answers);
  const theirsByQ = answersByQuestion(theirs.answers);
  let total = 0;
  let count = 0;
  for (const [questionId, mineSet] of mineByQ) {
    const theirSet = theirsByQ.get(questionId);
    if (!theirSet) continue;
    total += jaccard(mineSet, theirSet);
    count += 1;
  }
  return count === 0 ? null : total / count;
};

/** Set similarity for a plain string[] dimension; null when either side is empty. */
const setSimilarity = (
  mine?: string[] | null,
  theirs?: string[] | null,
): number | null => {
  const a = toTokenSet(mine);
  const b = toTokenSet(theirs);
  if (a.size === 0 || b.size === 0) return null;
  return jaccard(a, b);
};

const normalizeCity = (city?: string | null): string =>
  (city ?? '').toLowerCase().replace(/\s+/g, ' ').trim();

const sharesCity = (mine: ScoringCouple, theirs: ScoringCouple): boolean => {
  const a = normalizeCity(mine.locationCity);
  const b = normalizeCity(theirs.locationCity);
  return a.length > 0 && a === b;
};

// ─── Scoring ──────────────────────────────────────────────────────────────────

/** Raw 0–100 compatibility before the display-floor remap. */
const rawScore = (mine: ScoringCouple, theirs: ScoringCouple): number => {
  const similarities: Array<{ weight: number; value: number }> = [];

  const answerSim = answersSimilarity(mine, theirs);
  if (answerSim !== null) similarities.push({ weight: DIMENSION_WEIGHTS.answers, value: answerSim });

  const activitySim = setSimilarity(mine.activities, theirs.activities);
  if (activitySim !== null) similarities.push({ weight: DIMENSION_WEIGHTS.activities, value: activitySim });

  const behaviorSim = behaviorsSimilarity(mine.answers, theirs.answers);
  if (behaviorSim !== null)
    similarities.push({ weight: DIMENSION_WEIGHTS.behaviors, value: behaviorSim });

  const hostSim = hostingSimilarity(mine.answers, theirs.answers);
  if (hostSim !== null) similarities.push({ weight: DIMENSION_WEIGHTS.hosting, value: hostSim });

  const tableSim = matrixSimilarity(mine.answers, theirs.answers, 'q10', TABLE_COMPAT);
  if (tableSim !== null) similarities.push({ weight: DIMENSION_WEIGHTS.table, value: tableSim });

  const drinkSim = matrixSimilarity(mine.answers, theirs.answers, 'q11', DRINKS_COMPAT);
  if (drinkSim !== null) similarities.push({ weight: DIMENSION_WEIGHTS.drinks, value: drinkSim });

  const vibeSim = setSimilarity(mine.socialVibes, theirs.socialVibes);
  if (vibeSim !== null) similarities.push({ weight: DIMENSION_WEIGHTS.socialVibes, value: vibeSim });

  const criteriaSim = setSimilarity(mine.matchCriteria, theirs.matchCriteria);
  if (criteriaSim !== null) similarities.push({ weight: DIMENSION_WEIGHTS.matchCriteria, value: criteriaSim });

  const presentWeight = similarities.reduce((sum, s) => sum + s.weight, 0);
  const weighted = presentWeight === 0
    ? 0
    : similarities.reduce((sum, s) => sum + (s.weight / presentWeight) * s.value, 0);

  const cityBonus = sharesCity(mine, theirs) ? CITY_BONUS_POINTS : 0;
  const raw = weighted * SIMILARITY_POINTS + cityBonus;
  return Math.max(0, Math.min(100, raw));
};

/**
 * Deterministic 0–100 match score between two couples, floored at
 * {@link SCORE_FLOOR} (see its doc for why). Symmetric: scoreCouples(a, b)
 * always equals scoreCouples(b, a).
 */
export const scoreCouples = (mine: ScoringCouple, theirs: ScoringCouple): number => {
  const raw = rawScore(mine, theirs);
  return Math.round(SCORE_FLOOR + (raw * (100 - SCORE_FLOOR)) / 100);
};

// ─── Insights ─────────────────────────────────────────────────────────────────

const MAX_INSIGHTS = 2;

/**
 * Up to {@link MAX_INSIGHTS} short lines built ONLY from genuine overlaps —
 * never invented. Returns [] when the couples share nothing measurable (the
 * app shows its own neutral copy in that case). Deterministic: categories are
 * visited in fixed priority order and shared tokens are sorted.
 *
 * Copy stays warm and quiet per the product voice — statements about the two
 * couples, no urgency, no exclamation.
 */
export const generateInsights = (mine: ScoringCouple, theirs: ScoringCouple): string[] => {
  const insights: string[] = [];
  const push = (line: string): void => {
    if (insights.length < MAX_INSIGHTS && !insights.includes(line)) insights.push(line);
  };

  const mineByQ = answersByQuestion(mine.answers);
  const theirsByQ = answersByQuestion(theirs.answers);
  const sharedForQuestion = (questionId: string): string[] => {
    const a = mineByQ.get(questionId);
    const b = theirsByQ.get(questionId);
    return a && b ? intersect(a, b) : [];
  };

  // 0. Complementary hosting — the strongest possible first line: it names
  //    exactly how an evening between these four people would work.
  const myHosting = rawOptionIds(mine.answers, 'q7a')[0];
  const theirHosting = rawOptionIds(theirs.answers, 'q7a')[0];
  if (myHosting && theirHosting && myHosting !== theirHosting) {
    push(
      myHosting === 'q7a-host'
        ? 'You love hosting, they love being hosted'
        : 'They love hosting, you love being hosted',
    );
  }

  // 0b. A shared free window — the plan writes itself.
  for (const token of sharedForQuestion('q9')) {
    push(`Same free window - ${token}`);
  }

  // 0c. Same real behavior last month.
  const myQ8 = new Set(rawOptionIds(mine.answers, 'q8'));
  for (const id of rawOptionIds(theirs.answers, 'q8')) {
    if (id !== 'q8-quiet' && myQ8.has(id)) {
      push(`${OPTION_LABELS[id] ?? id} - both of you, just last month`);
    }
  }

  // 0d. Tables that agree (only when it is a real constraint match).
  const myTable = rawOptionIds(mine.answers, 'q10')[0];
  if (myTable && myTable === rawOptionIds(theirs.answers, 'q10')[0] && myTable !== 'q10-all') {
    push(myTable === 'q10-veg' ? 'Both tables are vegetarian' : 'Both tables are non-vegetarian');
  }

  // 1. Things they both love doing — q3 answers merged with activity chips.
  //    The strongest, most concrete overlap; may contribute both insights.
  const sharedLoves = Array.from(
    new Set([
      ...sharedForQuestion('q3'),
      ...intersect(toTokenSet(mine.activities), toTokenSet(theirs.activities)),
    ]),
  ).sort();
  for (const token of sharedLoves) push(`You both love ${token}`);

  // 2. Same meeting pace (q4 labels all begin with "meeting …").
  for (const token of sharedForQuestion('q4')) {
    push(`Similar pace - you both prefer ${token}`);
  }

  // 3. Same life stage (q1).
  for (const token of sharedForQuestion('q1')) {
    push(`You're in a similar life stage - ${token}`);
  }

  // 4. Same couple personality (q2).
  for (const token of sharedForQuestion('q2')) {
    push(`Same couple energy - ${token}`);
  }

  // 5. Shared social vibes (free-form field, phrased generically).
  for (const token of intersect(toTokenSet(mine.socialVibes), toTokenSet(theirs.socialVibes))) {
    push(`You share a love for ${token}`);
  }

  return insights;
};

// ─── Convenience ──────────────────────────────────────────────────────────────

/** Score + insights in one pass — what the discovery feed and match rows store. */
export const evaluateMatch = (
  mine: ScoringCouple,
  theirs: ScoringCouple,
): { matchScore: number; insights: string[] } => ({
  matchScore: scoreCouples(mine, theirs),
  insights: generateInsights(mine, theirs),
});
