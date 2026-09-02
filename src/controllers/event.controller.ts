import { Request, Response } from 'express';
import { z } from 'zod';
import { eventService } from '../services/event.service';
import { sendSuccess } from '../utils/response';
import { validate } from '../middleware/validate';

// ─── Validation ─────────────────────────────────────────────────────────────

const EVENT_CATEGORIES = ['outdoors', 'sports', 'food_drinks', 'culture_arts', 'wellness', 'home'] as const;

const CreateEventSchema = z.object({
  title: z.string().trim().min(1, 'Title is required').max(80),
  description: z.string().trim().max(600).optional(),
  city: z.string().trim().min(1, 'City is required'),
  category: z.enum(EVENT_CATEGORIES),
  startsAt: z.coerce.date(),
  endsAt: z.coerce.date().optional(),
  venueName: z.string().trim().max(120).optional(),
  capacity: z.coerce.number().int().min(2).max(500).optional(),
  coverImageUrl: z.string().optional(),
  communityId: z.string().optional(),
});

export const validateCreateEvent = validate(CreateEventSchema);

// ─── Controllers ────────────────────────────────────────────────────────────

export const getEvents = async (req: Request, res: Response): Promise<void> => {
  const { coupleId } = req.user!;
  const { city, category } = req.query;

  const events = await eventService.getEvents(coupleId!, city as string, category as string);

  sendSuccess({ res, statusCode: 200, data: { events } });
};

export const getMyEvents = async (req: Request, res: Response): Promise<void> => {
  const { coupleId } = req.user!;

  const events = await eventService.getMyEvents(coupleId!);

  sendSuccess({ res, statusCode: 200, data: { events } });
};

export const getEventDetail = async (req: Request, res: Response): Promise<void> => {
  const { coupleId } = req.user!;
  const { id } = req.params;

  const event = await eventService.getEventDetail(coupleId!, id);

  sendSuccess({ res, statusCode: 200, data: { event } });
};

export const createEvent = async (req: Request, res: Response): Promise<void> => {
  const { coupleId } = req.user!;
  const data = req.body as z.infer<typeof CreateEventSchema>;

  const event = await eventService.createEvent(coupleId!, data);

  sendSuccess({
    res,
    statusCode: 201,
    data: { event },
    message: 'Sent for a quick look — we will let you know as soon as it is up.',
  });
};

export const rsvpEvent = async (req: Request, res: Response): Promise<void> => {
  const { coupleId } = req.user!;
  const { id } = req.params;

  const result = await eventService.rsvp(coupleId!, id);

  sendSuccess({ res, statusCode: 200, data: result });
};

export const unrsvpEvent = async (req: Request, res: Response): Promise<void> => {
  const { coupleId } = req.user!;
  const { id } = req.params;

  const result = await eventService.unrsvp(coupleId!, id);

  sendSuccess({ res, statusCode: 200, data: result });
};

export const cancelEvent = async (req: Request, res: Response): Promise<void> => {
  const { coupleId } = req.user!;
  const { id } = req.params;

  const result = await eventService.cancelEvent(coupleId!, id);

  sendSuccess({ res, statusCode: 200, data: result });
};
