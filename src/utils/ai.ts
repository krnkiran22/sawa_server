import OpenAI from 'openai';
import { logger } from './logger';
import { env } from '../config/env';

/**
 * Bio generation runs on OpenAI (switched from Groq, 2026-09-02 — the Groq
 * path returned empty bios in prod, leaving every new couple's About blank).
 *
 * The client is created lazily so the server boots and runs fine before
 * OPENAI_API_KEY lands in the environment: until then generation is skipped
 * with a warning and callers receive the same empty result as any other
 * generation failure (the app lets the couple write their own About).
 */
let client: OpenAI | null = null;
const getClient = (): OpenAI | null => {
  if (!env.OPENAI_API_KEY) return null;
  if (!client) client = new OpenAI({ apiKey: env.OPENAI_API_KEY });
  return client;
};

const BIO_MODEL = 'gpt-4o-mini';
const BIO_MAX_LINES = 2;
const BIO_MAX_WORDS = 45;

/**
 * Generates one shared couple bio ("Who we are") and match criteria.
 * Bio is a single voice for the pair — not two separate partner bios.
 */
export const generateCoupleBio = async (
  qaData: Array<{ question: string; answers: string[] }>,
): Promise<{ bio: string; matchCriteria: string[] }> => {
  const openai = getClient();
  if (!openai) {
    logger.warn('[OpenAI] OPENAI_API_KEY not set — skipping couple bio generation.');
    return { bio: '', matchCriteria: [] };
  }

  try {
    const context = qaData
      .map((item) => `Q: ${item.question}\nA: ${item.answers.join(', ')}`)
      .join('\n\n');

    const response = await openai.chat.completions.create({
      model: BIO_MODEL,
      messages: [
        {
          role: 'system',
          content: `You write profiles for SAWA, a couples social app in India.

OUTPUT: Return JSON only with:
1. "bio" — ONE shared bio for the couple (first-person plural: we, our, us). NOT two bios. NOT "Partner A / Partner B".
2. "matchCriteria" — ONE short sentence (max 20 words) about what kind of couples they click with.

BIO FORMAT (strict):
- 1 or 2 lines only (use \\n between lines if two lines).
- Each line is one natural sentence — warm, specific, sounds human-written.
- Total bio under ${BIO_MAX_WORDS} words.
- Never corporate or AI-sounding.

VOICE:
- NEVER state the relationship status (married, engaged, dating, years together) — the profile shows it as a tag beside their names; the bio is about how they live, not what they are.
- Pull one real detail from their answers (food, hosting, trips, pace, boundaries).
- If the answers carry the couple's OWN words (a favourite spot, an "ask us about"), weave the exact name or phrase into the bio — that specificity is the whole point. Never invent a place they didn't name.
- Gentle humour is fine. No emojis. No hashtags.
- Never use: journey, passionate, dynamic, foodie, adventure-seekers, partner in crime, love to laugh, vibe, energy, explore, connect, meaningful, authentic (as filler).

GOOD:
"We host more than we go out — weekends are for friends, good food, and staying up too late."
"Our calendars are full but we still make room for long dinners and slow Sunday mornings."
"Ask us about the biryani place we refuse to stop going to."

BAD:
"We are passionate about building meaningful connections and exploring life together."`,
        },
        {
          role: 'user',
          content: `Onboarding answers:\n\n${context}\n\nWrite JSON with "bio" (1–2 lines max) and "matchCriteria". One couple, one bio.`,
        },
      ],
      temperature: 0.85,
      max_tokens: 180,
      response_format: { type: 'json_object' },
    });

    let content = response.choices[0]?.message?.content || '{}';

    if (content.includes('```')) {
      content = content.replace(/```json|```/g, '').trim();
    }

    const parsed = JSON.parse(content);
    let bio = typeof parsed.bio === 'string' ? parsed.bio.trim() : '';

    bio = bio
      .replace(/\r\n/g, '\n')
      .split('\n')
      .map((line: string) => line.trim())
      .filter(Boolean)
      .slice(0, BIO_MAX_LINES)
      .join('\n');

    logger.info(`[OpenAI] Bio generation successful (${bio.split('\n').length} line(s)).`);

    return {
      bio,
      matchCriteria: parsed.matchCriteria ? [String(parsed.matchCriteria).trim()] : [],
    };
  } catch (err) {
    logger.error('[OpenAI] Failed to generate structured bio:', err);
    return { bio: '', matchCriteria: [] };
  }
};
