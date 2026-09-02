import { Request, Response } from 'express';
import { z } from 'zod';
import type { NudgeStatus } from '@prisma/client';
import { sendSuccess } from '../utils/response';
import { validate } from '../middleware/validate';
import { clampLimit } from '../utils/cursor';
import { getOverview, listDeliveries } from '../services/nudge/nudge.stats';
import * as nudgeAdmin from '../services/nudge/nudge.admin';

/**
 * /api/v1/admin/nudges — the Nudge Layer's control room: funnel, template
 * registry (what is approved at WATI), journeys, deliveries, and a test send.
 * Every endpoint sits behind adminAuth (admin.routes.ts) and zod (RULES §7);
 * all DB work lives in services/nudge/nudge.admin.ts (RULES §4).
 */

const FAMILY = z.string().regex(/^[a-z][a-z0-9_]{1,40}$/);
const LOCALE = z.enum(['en', 'hi', 'kn', 'mr']);
const STATUS = z.enum(['queued', 'sending', 'sent', 'delivered', 'read', 'failed', 'suppressed', 'cancelled']);

const overviewQuery = z.object({ days: z.coerce.number().int().min(1).max(90).default(7) });
export const validateOverviewQuery = validate(overviewQuery, 'query');

const templateBody = z.object({
  family: FAMILY,
  locale: LOCALE.default('en'),
  providerName: z.string().min(1).max(120),
  category: z.enum(['utility', 'marketing']).default('utility'),
  variables: z.array(z.string().min(1).max(40)).max(10).default([]),
  bodyPreview: z.string().max(1024).optional(),
  enabled: z.boolean().default(false),
  quickReplies: z.record(z.string().min(1).max(60), z.string().min(1).max(40)).optional(),
});
export const validateTemplateBody = validate(templateBody);

const templatePatch = templateBody.partial();
export const validateTemplatePatch = validate(templatePatch);

const idParams = z.object({ id: z.string().min(1).max(64).regex(/^[A-Za-z0-9_-]+$/) });
export const validateIdParams = validate(idParams, 'params');

const journeyPatch = z.object({
  name: z.string().min(1).max(80).optional(),
  enabled: z.boolean().optional(),
  config: z.record(z.string(), z.unknown()).optional(),
});
export const validateJourneyPatch = validate(journeyPatch);

const testSendBody = z.object({
  phone: z.string().regex(/^\+?\d{10,15}$/),
  family: FAMILY,
  locale: LOCALE.default('en'),
});
export const validateTestSendBody = validate(testSendBody);

const sendNoteBody = z.object({
  coupleId: z.string().min(1).max(64).regex(/^[A-Za-z0-9_-]+$/),
  text: z.string().min(1).max(500),
});
export const validateSendNoteBody = validate(sendNoteBody);

const deliveriesQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional(),
  cursor: z.string().optional(),
  family: FAMILY.optional(),
  status: STATUS.optional(),
});
export const validateDeliveriesQuery = validate(deliveriesQuery, 'query');

export const overview = async (req: Request, res: Response): Promise<void> => {
  const { days } = req.query as unknown as z.infer<typeof overviewQuery>;
  sendSuccess({ res, data: await getOverview(days) });
};

export const listTemplates = async (_req: Request, res: Response): Promise<void> => {
  sendSuccess({ res, data: await nudgeAdmin.listTemplates() });
};

export const upsertTemplate = async (req: Request, res: Response): Promise<void> => {
  const template = await nudgeAdmin.upsertTemplate(req.body as z.infer<typeof templateBody>, req.user?.userId);
  sendSuccess({ res, data: { template }, message: 'Template saved' });
};

export const patchTemplate = async (req: Request, res: Response): Promise<void> => {
  const { id } = req.params as z.infer<typeof idParams>;
  const template = await nudgeAdmin.patchTemplate(id, req.body as z.infer<typeof templatePatch>, req.user?.userId);
  sendSuccess({ res, data: { template }, message: 'Template updated' });
};

export const deleteTemplate = async (req: Request, res: Response): Promise<void> => {
  const { id } = req.params as z.infer<typeof idParams>;
  const deleted = await nudgeAdmin.deleteTemplate(id);
  sendSuccess({ res, data: { deleted }, message: 'Template deleted' });
};

export const listJourneys = async (_req: Request, res: Response): Promise<void> => {
  sendSuccess({ res, data: await nudgeAdmin.listJourneys() });
};

export const patchJourney = async (req: Request, res: Response): Promise<void> => {
  const { id } = req.params as z.infer<typeof idParams>;
  const journey = await nudgeAdmin.patchJourney(id, req.body as z.infer<typeof journeyPatch>, req.user?.userId);
  sendSuccess({ res, data: { journey }, message: 'Journey updated' });
};

export const testSend = async (req: Request, res: Response): Promise<void> => {
  const data = await nudgeAdmin.testSend(req.body as z.infer<typeof testSendBody>, req.user!.userId);
  sendSuccess({ res, data, message: 'Test message sent' });
};

export const sendNote = async (req: Request, res: Response): Promise<void> => {
  const body = req.body as z.infer<typeof sendNoteBody>;
  const data = await nudgeAdmin.sendCoupleNote(body.coupleId, body.text.trim(), req.user?.userId);
  sendSuccess({ res, data, message: 'Note sent' });
};

export const deliveries = async (req: Request, res: Response): Promise<void> => {
  const q = req.query as unknown as z.infer<typeof deliveriesQuery>;
  const data = await listDeliveries({
    limit: clampLimit(q.limit, 50, 100),
    cursor: q.cursor,
    family: q.family,
    status: q.status as NudgeStatus | undefined,
  });
  sendSuccess({ res, data });
};
