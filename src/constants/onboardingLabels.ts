/**
 * The ONE mapping from onboarding question/option ids to human labels.
 *
 * Three drifting copies of these maps used to live in admin.service (×2) and
 * couple.service's AI-bio path — the admin copies were missing the current
 * app's option ids entirely, so real couples' answers rendered as raw slugs
 * ("q4-similar") in the panel, and q4's label still said "Meeting Frequency"
 * after the app repurposed q4 to "what kind of couples are you into?"
 * (RULES §7 DRY; admin-details audit 2026-08-27).
 *
 * Legacy ids stay forever: old rows in the DB still carry them.
 */

export const OPTION_LABELS: Record<string, string> = {
  // q1 — life stage (current + legacy share these)
  'q1-career': 'Building careers',
  'q1-family': 'Family first',
  'q1-settled': 'Newly settled',
  'q1-living': 'Living it up',
  'q1-growing': 'Growing together',
  'q1-adventure': 'Always exploring',
  // q2 — couple personality
  'q2-hosts': 'The Hosts',
  'q2-yes': "The 'yes' couple", // current app id
  'q2-yes-couple': "The 'yes' couple", // legacy id
  'q2-planners': 'The Planners',
  'q2-explorers': 'The Explorers',
  // q3 — favorite activities
  'q3-dinner': 'Dinner at home', // current app id
  'q3-dinners-home': 'Dinners at home', // legacy id
  'q3-restaurants': 'Exploring new restaurants',
  'q3-outdoor': 'Outdoor activities/nature',
  'q3-cultural': 'Cultural events/museums',
  'q3-drinks': 'Casual drinks',
  'q3-trips': 'Weekend trips/travel',
  // q4 CURRENT — what kind of couples are you into
  'q4-similar': 'Very similar',
  'q4-balanced': 'Balanced mix',
  'q4-diverse': 'Very different',
  // q4 LEGACY — meeting frequency
  'q4-once-month': 'Meeting once a month',
  'q4-twice-month': 'Meeting twice a month',
  'q4-once-week': 'Meeting once a week',
  'q4-when-fits': 'Meeting whenever it fits',
  // q5/q6 — legacy-only questions
  'q5-similar-stage': 'Matches in a similar life stage',
  'q5-shared-interests': 'Shared interests',
  'q5-small-groups': 'Small group settings',
  'q5-structured-plans': 'Structured plans',
  'q5-clear-boundaries': 'Clear boundaries',
  'q5-weekend-availability': 'Weekend availability',
  'q6-late-night': 'Avoiding late-night plans',
  'q6-large-groups': 'Avoiding very large groups',
  'q6-alcohol-centric': 'Avoiding alcohol-centric meetups',
  'q6-last-minute': 'Avoiding last-minute/spontaneous plans',
};

const QUESTION_LABELS: Record<string, string> = {
  q1: 'Life stage',
  q2: 'Couple personality',
  q3: 'Favorite activities',
  q4: 'Kind of couples they like', // current meaning; legacy resolved below
  q5: 'What makes a good match',
  q6: 'Things to avoid',
};

/** q4 changed meaning between app generations — label it by the options it holds. */
const LEGACY_Q4 = new Set(['q4-once-month', 'q4-twice-month', 'q4-once-week', 'q4-when-fits']);

/** One answer row → display {question, options}, correct for both generations. */
export function labelAnswer(
  questionId: string,
  selectedOptionIds: string[],
): { question: string; options: string[] } {
  let question = QUESTION_LABELS[questionId] || questionId;
  if (questionId === 'q4' && selectedOptionIds.some((id) => LEGACY_Q4.has(id))) {
    question = 'Meeting frequency';
  }
  return {
    question,
    options: selectedOptionIds.map((id) => OPTION_LABELS[id] || id),
  };
}
