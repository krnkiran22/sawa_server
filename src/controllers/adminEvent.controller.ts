import { Request, Response } from 'express';
import { z } from 'zod';
import { eventService } from '../services/event.service';
import { sendSuccess } from '../utils/response';
import { validate } from '../middleware/validate';

// Admin surface for Events: the approval queue for couple-proposed events and
// CRUD for Sawa-listed (curated) ones. Mounted under adminAuth in admin.routes.

// ─── Validation ─────────────────────────────────────────────────────────────

const EVENT_CATEGORIES = ['outdoors', 'sports', 'food_drinks', 'culture_arts', 'wellness', 'home'] as const;

const AdminCreateEventSchema = z.object({
  title: z.string().trim().min(1, 'Title is required').max(80),
  description: z.string().trim().max(600).optional(),
  city: z.string().trim().min(1, 'City is required'),
  category: z.enum(EVENT_CATEGORIES),
  startsAt: z.coerce.date(),
  endsAt: z.coerce.date().optional(),
  venueName: z.string().trim().max(120).optional(),
  capacity: z.coerce.number().int().min(2).max(500).optional(),
  coverImageUrl: z.string().optional(),
  coverImageBase64: z.string().optional(),
});

const AdminPatchEventSchema = z
  .object({
    title: z.string().trim().min(1).max(80),
    description: z.string().trim().max(600),
    city: z.string().trim().min(1),
    category: z.enum(EVENT_CATEGORIES),
    startsAt: z.coerce.date(),
    endsAt: z.coerce.date().nullable(),
    venueName: z.string().trim().max(120),
    capacity: z.coerce.number().int().min(2).max(500).nullable(),
    coverImageUrl: z.string(),
    coverImageBase64: z.string(),
  })
  .partial();

const AdminRejectEventSchema = z.object({
  note: z.string().trim().max(300).optional(),
});

const IdParamsSchema = z.object({ id: z.string().min(1) });

export const validateAdminCreateEvent = validate(AdminCreateEventSchema);
export const validateAdminPatchEvent = validate(AdminPatchEventSchema);
export const validateAdminRejectEvent = validate(AdminRejectEventSchema);
export const validateEventIdParams = validate(IdParamsSchema, 'params');

// ─── Controllers ────────────────────────────────────────────────────────────

export const listEvents = async (_req: Request, res: Response): Promise<void> => {
  const events = await eventService.adminListEvents();
  sendSuccess({ res, statusCode: 200, data: { events } });
};

export const createEvent = async (req: Request, res: Response): Promise<void> => {
  const data = req.body as z.infer<typeof AdminCreateEventSchema>;
  const event = await eventService.adminCreateEvent(data);
  sendSuccess({ res, statusCode: 201, data: { event }, message: 'Event listed' });
};

export const patchEvent = async (req: Request, res: Response): Promise<void> => {
  const { id } = req.params;
  const data = req.body as z.infer<typeof AdminPatchEventSchema>;
  const event = await eventService.adminUpdateEvent(id, data);
  sendSuccess({ res, statusCode: 200, data: { event }, message: 'Event updated' });
};

export const approveEvent = async (req: Request, res: Response): Promise<void> => {
  const { id } = req.params;
  const result = await eventService.adminApproveEvent(id);
  sendSuccess({ res, statusCode: 200, data: result, message: 'Event approved' });
};

export const rejectEvent = async (req: Request, res: Response): Promise<void> => {
  const { id } = req.params;
  const { note } = req.body as z.infer<typeof AdminRejectEventSchema>;
  const result = await eventService.adminRejectEvent(id, note);
  sendSuccess({ res, statusCode: 200, data: result, message: 'Event rejected' });
};

export const deleteEvent = async (req: Request, res: Response): Promise<void> => {
  const { id } = req.params;
  const result = await eventService.adminDeleteEvent(id);
  sendSuccess({ res, statusCode: 200, data: result, message: 'Event deleted' });
};
