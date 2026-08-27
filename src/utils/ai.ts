import OpenAI from 'openai';
import { logger } from './logger';
import { env } from '../config/env';

const client = new OpenAI({
  apiKey: env.GROQ_API_KEY,
  baseURL: 'https://api.groq.com/openai/v1',
});

const BIO_MAX_LINES = 2;
const BIO_MAX_WORDS = 45;

/**
 * Generates one shared couple bio ("Who we are") and match criteria.
 * Bio is a single voice for the pair — not two separate partner bios.
 */
export const generateCoupleBio = async (
  qaData: Array<{ question: string; answers: string[] }>,
): Promise<{ bio: string; matchCriteria: string[] }> => {
  try {
    const context = qaData
      .map((item) => `Q: ${item.question}\nA: ${item.answers.join(', ')}`)
      .join('\n\n');

    const response = await client.chat.completions.create({
      model: 'llama-3.3-70b-versatile',
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
- Pull one real detail from their answers (food, hosting, trips, pace, boundaries).
- Gentle humour is fine. No emojis. No hashtags.
- Never use: journey, passionate, dynamic, foodie, adventure-seekers, partner in crime, love to laugh, vibe, energy, explore, connect, meaningful, authentic (as filler).

GOOD:
"We host more than we go out — weekends are for friends, good food, and staying up too late."
"Our calendars are full but we still make room for long dinners and slow Sunday mornings."

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

    logger.info(`[GroqAI] Bio generation successful (${bio.split('\n').length} line(s)).`);

    return {
      bio,
      matchCriteria: parsed.matchCriteria ? [String(parsed.matchCriteria).trim()] : [],
    };
  } catch (err) {
    logger.error('[GroqAI] Failed to generate structured bio:', err);
    return { bio: '', matchCriteria: [] };
  }
};
