import { Router } from 'express';
import { authenticate } from '../middleware/authenticate';
import { asyncHandler } from '../utils/asyncHandler';
import {
  getEvents,
  getMyEvents,
  getEventDetail,
  createEvent,
  rsvpEvent,
  unrsvpEvent,
  cancelEvent,
  validateCreateEvent,
} from '../controllers/event.controller';

const router = Router();

router.use(authenticate);

// GET /api/v1/events?city=&category=  — approved upcoming events (the feed)
router.get('/', asyncHandler(getEvents));

// GET /api/v1/events/mine — created (any status) + going
router.get('/mine', asyncHandler(getMyEvents));

// POST /api/v1/events — propose an event; born pending, admin approval is the
// gate (invite-only brand promise). Entitlement gating deliberately deferred
// until Prime returns (see PLAN.md).
router.post('/', validateCreateEvent, asyncHandler(createEvent));

// GET /api/v1/events/:id
router.get('/:id', asyncHandler(getEventDetail));

// POST /api/v1/events/:id/rsvp — going (idempotent; capacity fails closed)
router.post('/:id/rsvp', asyncHandler(rsvpEvent));

// DELETE /api/v1/events/:id/rsvp — not going after all
router.delete('/:id/rsvp', asyncHandler(unrsvpEvent));

// POST /api/v1/events/:id/cancel — creator calls their own event off
router.post('/:id/cancel', asyncHandler(cancelEvent));

export default router;
