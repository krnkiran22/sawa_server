import { prisma } from '../../lib/prisma';
import { logger } from '../../utils/logger';
import type { NudgeCategory } from '@prisma/client';

/**
 * WhatsApp template registry.
 *
 * One row per (family, locale). `providerName` is the template's name at the
 * BSP (WATI) exactly as approved by Meta; `variables` names, in order, the
 * resolvers (nudge.copy.ts) that fill {{1}}..{{n}}. Rows seed DISABLED: a
 * family only goes out once the template exists at WATI and admin flips
 * `enabled`, which is how "approved" is represented here. Seeding never
 * overwrites an existing row, so admin edits survive deploys.
 *
 * Body copy is the canonical §11.7 text in SAWA_Master_Reference.md. Change
 * it there first, then here, then re-submit the template at WATI.
 */

export interface TemplateSeed {
  family: string;
  locale: string;
  providerName: string;
  category: NudgeCategory;
  variables: string[];
  bodyPreview: string;
  /** Button-title → action for inbound quick replies (Phase 2). */
  quickReplies?: Record<string, string>;
}

export const TEMPLATE_SEEDS: TemplateSeed[] = [
  {
    family: 'welcome',
    locale: 'en',
    providerName: 'sawa_welcome',
    category: 'utility',
    variables: ['recipientName', 'link'],
    bodyPreview:
      'Welcome to Sawa, {{1}}. This is the space you two will share: moods, little notes, plans, and couples worth meeting. Set up your profile together: {{2}}',
  },
  {
    family: 'partner_invite',
    locale: 'en',
    providerName: 'sawa_partner_invite',
    category: 'utility',
    variables: ['link'],
    bodyPreview: 'Your partner has joined Sawa and is waiting for you. Download the app: {{1}}',
  },
  {
    family: 'partner_waiting',
    locale: 'en',
    providerName: 'sawa_partner_waiting',
    category: 'utility',
    variables: ['partnerName', 'link'],
    bodyPreview:
      '{{1}} set up your shared Sawa profile and is waiting for you. It takes two minutes to join: {{2}}',
  },
  {
    family: 'us_mood',
    locale: 'en',
    providerName: 'sawa_mood',
    category: 'utility',
    variables: ['name', 'poss', 'subjBe', 'feeling', 'link'],
    bodyPreview:
      "{{1}} just shared {{2}} mood. {{3}} feeling {{4}} 💛 Want to share how you're feeling? {{5}}",
    quickReplies: { 'Send love back': 'us_love' },
  },
  {
    family: 'us_fridge_note',
    locale: 'en',
    providerName: 'sawa_fridge_note',
    category: 'utility',
    variables: ['name', 'note', 'link'],
    bodyPreview: '{{1}} left you a little note on the fridge: "{{2}}" See it in Sawa: {{3}}',
    quickReplies: { 'Got it': 'open' },
  },
  {
    family: 'us_game_challenge',
    locale: 'en',
    providerName: 'sawa_game_challenge',
    category: 'utility',
    variables: ['name', 'game', 'link'],
    bodyPreview: "{{1}} just challenged you to {{2}} 🎲 Tap yes in Sawa and you're on: {{3}}",
  },
  {
    family: 'match_pending',
    locale: 'en',
    providerName: 'sawa_hello',
    category: 'utility',
    variables: ['profileName', 'link'],
    bodyPreview:
      "{{1}} said hello to you two on Sawa. Take a look and see if you'd like to connect: {{2}}",
  },
  {
    family: 'admin_note',
    locale: 'en',
    providerName: 'sawa_admin_note',
    category: 'utility',
    variables: ['recipientName', 'note', 'link'],
    bodyPreview: 'Hi {{1}}, a quick note from the Sawa team: {{2}} Open Sawa: {{3}}',
  },
  {
    family: 'sawa_update',
    locale: 'en',
    providerName: 'sawa_update',
    category: 'utility',
    variables: ['text', 'link'],
    bodyPreview: '{{1}} Open Sawa: {{2}}',
  },
  // ── Journeys (proactive, marketing-priced) ─────────────────────────────────
  {
    family: 'first_mood',
    locale: 'en',
    providerName: 'sawa_first_mood',
    category: 'marketing',
    variables: ['partnerName', 'link'],
    bodyPreview: 'How are you both feeling today? A quick mood in Sawa lets {{1}} know: {{2}}',
  },
  {
    family: 'first_circle',
    locale: 'en',
    providerName: 'sawa_first_circle',
    category: 'marketing',
    variables: ['city', 'link'],
    bodyPreview: "There's a circle in {{1}} that might be your kind of people. Take a look: {{2}}",
  },
  {
    family: 'first_game',
    locale: 'en',
    providerName: 'sawa_first_game',
    category: 'marketing',
    variables: ['partnerName', 'link'],
    bodyPreview: 'Two minutes, one game. Challenge {{1}} to a quick round: {{2}}',
  },
  {
    family: 'friday_plan',
    locale: 'en',
    providerName: 'sawa_friday_plan',
    category: 'marketing',
    variables: ['suggestion', 'link'],
    bodyPreview: "It's Friday, you two. {{1}} Plan something small for the weekend: {{2}}",
  },
  {
    family: 'sunday_checkin',
    locale: 'en',
    providerName: 'sawa_sunday_checkin',
    category: 'marketing',
    variables: ['link'],
    bodyPreview: 'How was the week, you two? Share a mood and a little note: {{1}}',
  },
  {
    family: 'quiet_couple',
    locale: 'en',
    providerName: 'sawa_quiet_couple',
    category: 'marketing',
    variables: ['link'],
    bodyPreview: "It's been a while, you two. A quick game or a little note is all it takes: {{1}}",
  },
];

/** Insert any seed whose (family, locale) is missing. Never overwrites. */
export async function seedTemplates(): Promise<void> {
  try {
    const existing = await prisma.nudgeTemplate.findMany({ select: { family: true, locale: true } });
    const have = new Set(existing.map((t) => `${t.family}:${t.locale}`));
    const missing = TEMPLATE_SEEDS.filter((s) => !have.has(`${s.family}:${s.locale}`));
    if (missing.length === 0) return;
    await prisma.nudgeTemplate.createMany({
      data: missing.map((s) => ({
        family: s.family,
        locale: s.locale,
        providerName: s.providerName,
        category: s.category,
        variables: s.variables,
        bodyPreview: s.bodyPreview,
        quickReplies: s.quickReplies ?? undefined,
        enabled: false,
      })),
    });
    logger.info(`[Nudge] seeded ${missing.length} WhatsApp template row(s) (disabled until approved)`);
  } catch (err: any) {
    logger.warn(`[Nudge] template seed failed: ${err?.message ?? err}`);
  }
}

export interface ResolvedTemplate {
  id: string;
  family: string;
  locale: string;
  providerName: string;
  variables: string[];
  bodyPreview: string | null;
  quickReplies: Record<string, string> | null;
}

/**
 * The enabled template for a family in the recipient's locale, falling back
 * to English. Null when nothing is enabled for the family (any locale), which
 * the policy reports as `no_template`.
 */
export async function resolveTemplate(family: string, locale: string | null | undefined): Promise<ResolvedTemplate | null> {
  const rows = await prisma.nudgeTemplate.findMany({
    where: { family, enabled: true },
    select: { id: true, family: true, locale: true, providerName: true, variables: true, bodyPreview: true, quickReplies: true },
  });
  if (rows.length === 0) return null;
  const want = locale && rows.some((r) => r.locale === locale) ? locale : 'en';
  const row = rows.find((r) => r.locale === want) ?? rows[0];
  return {
    id: row.id,
    family: row.family,
    locale: row.locale,
    providerName: row.providerName,
    variables: row.variables,
    bodyPreview: row.bodyPreview,
    quickReplies: (row.quickReplies as Record<string, string> | null) ?? null,
  };
}

/** Families that currently have at least one enabled template. */
export async function enabledFamilies(): Promise<Set<string>> {
  const rows = await prisma.nudgeTemplate.findMany({
    where: { enabled: true },
    select: { family: true },
    distinct: ['family'],
  });
  return new Set(rows.map((r) => r.family));
}
