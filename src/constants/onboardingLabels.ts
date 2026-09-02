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
  // ── v2 questionnaire (2026-09-02): forced choices, behavior, practicals ──
  // q7a–q7f — this-or-that pairs (one pick each)
  'q7a-host': 'Hosting at ours',
  'q7a-guest': 'Being hosted',
  'q7b-plan': 'Planning a week ahead',
  'q7b-spont': 'Deciding at 6pm',
  'q7c-late': 'Out till late',
  'q7c-early': 'Early start, early home',
  'q7d-one': 'One couple, long dinner',
  'q7d-full': 'A full table',
  'q7e-usual': 'The usual spot we love',
  'q7e-new': 'Somewhere new every time',
  'q7f-in': 'Indoors and games',
  'q7f-out': 'Outside and moving',
  // q8 — what they actually did last month
  'q8-hosted': 'Had people over',
  'q8-newspot': 'Tried a new restaurant',
  'q8-daytrip': 'Took a day trip',
  'q8-games': 'Played board or video games',
  'q8-active': 'Worked out or ran together',
  'q8-show': 'A live show or a movie hall',
  'q8-quiet': 'A quiet month',
  // q9 — when they are usually free
  'q9-frinight': 'Friday nights',
  'q9-satday': 'Saturday daytime',
  'q9-satnight': 'Saturday nights',
  'q9-sunbrunch': 'Sunday brunch',
  'q9-weekday': 'Weekday evenings',
  // q10 — the table
  'q10-veg': 'A vegetarian table',
  'q10-nonveg': 'A non-vegetarian table',
  'q10-all': 'Everything goes',
  // q11 — drinks
  'q11-yes': 'Drinks happily on the table',
  'q11-some': 'Drinks sometimes',
  'q11-no': 'Skipping the drinks',
};

const QUESTION_LABELS: Record<string, string> = {
  q1: 'Life stage',
  q2: 'Couple personality',
  q3: 'Favorite activities',
  q4: 'Kind of couples they like', // current meaning; legacy resolved below
  q5: 'What makes a good match',
  q6: 'Things to avoid',
  q7a: 'Host or be hosted',
  q7b: 'Planners or spontaneous',
  q7c: 'Late nights or early starts',
  q7d: 'Intimate dinners or full tables',
  q7e: 'Usual spot or somewhere new',
  q7f: 'Indoors or outdoors',
  q8: 'What they actually did last month',
  q9: 'When they are usually free',
  q10: 'Their table',
  q11: 'Drinks',
  'q12-spot': 'The spot they keep going back to',
  'q12-askus': 'Ask them about',
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
