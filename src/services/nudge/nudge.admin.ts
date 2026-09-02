import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { AppError } from '../../utils/AppError';
import { logger } from '../../utils/logger';
import { knownVariable, renderVariables, VARIABLE_IDS } from './nudge.copy';
import { getWhatsAppProvider, toWhatsAppDigits } from './channels/whatsapp.channel';
import { buildLinkUrl } from './nudge.links';
import { TEMPLATE_SEEDS } from './nudge.templates';
import { JOURNEY_SEEDS } from './nudge.journeys';
import { enqueueForRecipients } from './nudge.engine';
import { emitRealtimeNotification } from '../../utils/realtime';

/**
 * Admin-side operations on the Nudge Layer's registry (templates, journeys)
 * and the test send. The controller (controllers/adminNudge.controller.ts)
 * only validates and shapes HTTP; every DB touch lives here (RULES §4: no new
 * direct-prisma calls in a controller).
 */

export interface TemplateInput {
  family: string;
  locale: string;
  providerName: string;
  category: 'utility' | 'marketing';
  variables: string[];
  bodyPreview?: string;
  enabled: boolean;
  quickReplies?: Record<string, string>;
}

export type TemplatePatch = Partial<TemplateInput>;

export interface JourneyPatch {
  name?: string;
  enabled?: boolean;
  config?: Record<string, unknown>;
}

const assertKnownVariables = (vars: string[]): void => {
  const bad = vars.filter((v) => !knownVariable(v));
  if (bad.length) {
    throw new AppError(
      `Unknown variable id(s): ${bad.join(', ')}. Known: ${VARIABLE_IDS.join(', ')}`,
      400,
      'VALIDATION',
    );
  }
};

export async function listTemplates() {
  const templates = await prisma.nudgeTemplate.findMany({ orderBy: [{ family: 'asc' }, { locale: 'asc' }] });
  return {
    templates,
    variableIds: VARIABLE_IDS,
    seeds: TEMPLATE_SEEDS.map((s) => ({
      family: s.family,
      locale: s.locale,
      providerName: s.providerName,
      bodyPreview: s.bodyPreview,
      variables: s.variables,
      category: s.category,
    })),
  };
}

export async function upsertTemplate(input: TemplateInput, adminId: string | undefined) {
  assertKnownVariables(input.variables);
  const quickReplies = (input.quickReplies ?? undefined) as Prisma.InputJsonValue | undefined;
  const template = await prisma.nudgeTemplate.upsert({
    where: { family_locale: { family: input.family, locale: input.locale } },
    create: {
      family: input.family,
      locale: input.locale,
      providerName: input.providerName,
      category: input.category,
      variables: input.variables,
      bodyPreview: input.bodyPreview,
      enabled: input.enabled,
      quickReplies,
    },
    update: {
      providerName: input.providerName,
      category: input.category,
      variables: input.variables,
      bodyPreview: input.bodyPreview,
      enabled: input.enabled,
      quickReplies,
    },
  });
  logger.info(
    `[Nudge] admin ${adminId} saved template ${template.family}/${template.locale} (${template.providerName}, enabled=${template.enabled})`,
  );
  return template;
}

export async function patchTemplate(id: string, patch: TemplatePatch, adminId: string | undefined) {
  if (patch.variables) assertKnownVariables(patch.variables);
  const existing = await prisma.nudgeTemplate.findUnique({ where: { id }, select: { id: true } });
  if (!existing) throw new AppError('Template not found', 404, 'NOT_FOUND');
  const template = await prisma.nudgeTemplate.update({
    where: { id },
    data: {
      ...(patch.family !== undefined ? { family: patch.family } : {}),
      ...(patch.locale !== undefined ? { locale: patch.locale } : {}),
      ...(patch.providerName !== undefined ? { providerName: patch.providerName } : {}),
      ...(patch.category !== undefined ? { category: patch.category } : {}),
      ...(patch.variables !== undefined ? { variables: patch.variables } : {}),
      ...(patch.bodyPreview !== undefined ? { bodyPreview: patch.bodyPreview } : {}),
      ...(patch.enabled !== undefined ? { enabled: patch.enabled } : {}),
      ...(patch.quickReplies !== undefined ? { quickReplies: patch.quickReplies as Prisma.InputJsonValue } : {}),
    },
  });
  logger.info(`[Nudge] admin ${adminId} patched template ${template.family}/${template.locale} (enabled=${template.enabled})`);
  return template;
}

export async function deleteTemplate(id: string): Promise<number> {
  const r = await prisma.nudgeTemplate.deleteMany({ where: { id } });
  if (r.count === 0) throw new AppError('Template not found', 404, 'NOT_FOUND');
  return r.count;
}

export async function listJourneys() {
  const journeys = await prisma.journey.findMany({ orderBy: { key: 'asc' } });
  return { journeys, seeds: JOURNEY_SEEDS };
}

export async function patchJourney(id: string, patch: JourneyPatch, adminId: string | undefined) {
  const existing = await prisma.journey.findUnique({ where: { id }, select: { id: true } });
  if (!existing) throw new AppError('Journey not found', 404, 'NOT_FOUND');
  const journey = await prisma.journey.update({
    where: { id },
    data: {
      ...(patch.name !== undefined ? { name: patch.name } : {}),
      ...(patch.enabled !== undefined ? { enabled: patch.enabled } : {}),
      ...(patch.config !== undefined ? { config: patch.config as Prisma.InputJsonValue } : {}),
    },
  });
  logger.info(`[Nudge] admin ${adminId} patched journey ${journey.key} (enabled=${journey.enabled})`);
  return journey;
}

/** Sample context for the admin test send: a whole moment in miniature. */
const SAMPLE_CONTEXT = {
  name: 'Neha',
  g: 'f' as const,
  feeling: 'Calm',
  note: 'Water the plants before Sunday 🌱',
  game: 'Tic Tac Toe',
  profileName: 'Rahul & Aarushi',
  recipientName: 'Karan',
  partnerName: 'Neha',
  city: 'Bengaluru',
  community: 'Weekend Treks',
  suggestion: "Your city's Brunch Clubs circle has something on.",
  text: 'A test from the Sawa admin panel.',
};

/**
 * Send one template to one phone with sample variables, bypassing recipient
 * policy but NOT the provider config. Recorded as `test_<family>` so the
 * attempt is auditable and never pollutes the real family's funnel.
 */
export async function testSend(input: { phone: string; family: string; locale: string }, adminUserId: string) {
  const provider = getWhatsAppProvider();
  if (!provider) throw new AppError('WhatsApp is not enabled or the provider is not configured', 503, 'WHATSAPP_DISABLED');
  const digits = toWhatsAppDigits(input.phone);
  if (!digits) throw new AppError('Invalid phone', 400, 'VALIDATION');

  const template =
    (await prisma.nudgeTemplate.findUnique({ where: { family_locale: { family: input.family, locale: input.locale } } })) ??
    (await prisma.nudgeTemplate.findUnique({ where: { family_locale: { family: input.family, locale: 'en' } } }));
  if (!template) throw new AppError('No template row for that family', 404, 'NOT_FOUND');

  const row = await prisma.nudgeDelivery.create({
    data: {
      family: `test_${input.family}`,
      channel: 'whatsapp',
      recipientUserId: adminUserId,
      coupleId: 'admin-test',
      phone: digits,
      locale: template.locale,
      status: 'sending',
      templateKey: template.providerName,
    },
    select: { id: true },
  });
  const token = `test_${row.id}`;
  const variables = renderVariables(template.variables, { ...SAMPLE_CONTEXT, link: buildLinkUrl(token) }, template.locale);
  const result = await provider.sendTemplate({
    toDigits: digits,
    templateName: template.providerName,
    variables,
    label: `sawa_test_${input.family}`,
    locale: template.locale,
  });
  await prisma.nudgeDelivery.update({
    where: { id: row.id },
    data: result.ok
      ? { status: 'sent', sentAt: new Date(), providerMessageId: result.providerMessageId ?? null, variables, linkToken: token }
      : { status: 'failed', failedAt: new Date(), error: result.error ?? 'send_failed', variables, linkToken: token },
  });
  logger.info(`[Nudge] admin ${adminUserId} test-send ${input.family} → ${digits.slice(0, 4)}…: ${result.ok ? 'ok' : result.error}`);
  if (!result.ok) throw new AppError(`Provider refused the send: ${result.error}`, 502, 'PROVIDER_ERROR');
  return { deliveryId: row.id, providerMessageId: result.providerMessageId ?? null, variables };
}

/**
 * Sailee's message box (2026-09-02): one couple, one human-written note, three
 * surfaces at once — in-app Notification row, push, and WhatsApp to both
 * partners (family 'admin_note': free text inside an open 24h session, the
 * approved template otherwise; recipient policy still applies, so opt-outs
 * and caps hold and every held-back send is visible in the deliveries table).
 */
export async function sendCoupleNote(coupleId: string, text: string, adminId: string | undefined) {
  const couple = await prisma.couple.findUnique({ where: { coupleId }, select: { coupleId: true } });
  if (!couple) throw new AppError('Couple not found', 404, 'NOT_FOUND');
  const users = await prisma.user.findMany({ where: { coupleId }, select: { id: true } });
  if (users.length === 0) throw new AppError('Couple has no members', 404, 'NOT_FOUND');

  const title = 'A note from the Sawa team';
  const notif = await prisma.notification.create({
    data: { recipientId: coupleId, type: 'admin', title, message: text, data: { subtype: 'admin' } },
  });
  // Socket + FCM push (emitRealtimeNotification carries both).
  emitRealtimeNotification(coupleId, {
    notificationId: notif.id,
    type: 'admin',
    title,
    message: text,
    data: { subtype: 'admin', notificationId: notif.id },
  });

  const r = await enqueueForRecipients({
    family: 'admin_note',
    coupleId,
    recipientUserIds: users.map((u) => u.id),
    ctxExtra: { note: text },
  });
  logger.info(`[Nudge] admin ${adminId} sent a note to couple ${coupleId} (whatsapp queued=${r.queued}, held=${r.suppressed})`);
  return { notificationId: notif.id, whatsappQueued: r.queued, whatsappHeld: r.suppressed };
}
