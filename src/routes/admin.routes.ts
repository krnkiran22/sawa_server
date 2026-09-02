import { Router } from 'express';
import { AdminController } from '../controllers/admin.controller';

import { adminAuth } from '../middleware/adminAuth';
import { authRateLimiter } from '../middleware/rateLimiter';
import { asyncHandler } from '../utils/asyncHandler';
import * as nudgeAdmin from '../controllers/adminNudge.controller';
import * as eventAdmin from '../controllers/adminEvent.controller';

const router = Router();
const controller = new AdminController();

// Public admin login — rate-limited to throttle online password guessing.
router.post('/login', authRateLimiter, controller.adminLogin);

// Lazy media (couple photo / community cover). Self-authenticates via ?token=
// query param because <img> tags cannot send an Authorization header. Must be
// registered BEFORE the header-based adminAuth middleware.
router.get('/media/:kind/:id', controller.getMedia);

// Protected admin routes
router.use(adminAuth);

router.get('/data', controller.getDashboardData);
router.post('/prompts', controller.addPrompt);
router.patch('/prompts/reorder', controller.reorderPrompts);
router.patch('/prompts/:id/toggle', controller.togglePrompt);
router.patch('/prompts/:id', controller.editPrompt);
router.delete('/prompts/:id', controller.deletePrompt);
router.delete('/users/:id', controller.deleteUser);
router.delete('/couples/:id', controller.deleteCouple);
router.post('/couples/:id/ban', controller.banCouple);
router.post('/couples/:id/unban', controller.unbanCouple);
// Verification pipeline: approve → verified; request-changes → note, stays
// pending; reject → locked + reason, deleted on user acknowledgment.
router.post('/couples/:id/approve', controller.approveCouple);
router.post('/couples/:id/request-changes', controller.requestCoupleChanges);
router.post('/couples/:id/reject', controller.rejectCouple);
router.delete('/communities/:id', controller.deleteCommunity);
router.post('/communities', controller.addCommunity);
router.patch('/communities/:id', controller.editCommunity);
router.post(
  '/communities/:communityId/requests/:requestId/:decision',
  controller.processJoinRequestAsAdmin,
);
router.get('/blocks', controller.getBlocks);
router.delete('/blocks', controller.adminUnblock);
router.patch('/reports/:id', controller.resolveReport);
router.post('/notifications', controller.sendNotification);
router.post('/flush-database', controller.flushDatabase);

// ─── Events (controllers/adminEvent.controller.ts) ───────────────────────────
// Approval queue for couple-proposed events + CRUD for Sawa-listed ones.
router.get('/events', asyncHandler(eventAdmin.listEvents));
router.post('/events', eventAdmin.validateAdminCreateEvent, asyncHandler(eventAdmin.createEvent));
router.patch('/events/:id', eventAdmin.validateEventIdParams, eventAdmin.validateAdminPatchEvent, asyncHandler(eventAdmin.patchEvent));
router.post('/events/:id/approve', eventAdmin.validateEventIdParams, asyncHandler(eventAdmin.approveEvent));
router.post('/events/:id/reject', eventAdmin.validateEventIdParams, eventAdmin.validateAdminRejectEvent, asyncHandler(eventAdmin.rejectEvent));
router.delete('/events/:id', eventAdmin.validateEventIdParams, asyncHandler(eventAdmin.deleteEvent));

// ─── Nudge Layer control room (controllers/adminNudge.controller.ts) ─────────
router.get('/nudges/overview', nudgeAdmin.validateOverviewQuery, asyncHandler(nudgeAdmin.overview));
router.get('/nudges/templates', asyncHandler(nudgeAdmin.listTemplates));
router.post('/nudges/templates', nudgeAdmin.validateTemplateBody, asyncHandler(nudgeAdmin.upsertTemplate));
router.patch('/nudges/templates/:id', nudgeAdmin.validateIdParams, nudgeAdmin.validateTemplatePatch, asyncHandler(nudgeAdmin.patchTemplate));
router.delete('/nudges/templates/:id', nudgeAdmin.validateIdParams, asyncHandler(nudgeAdmin.deleteTemplate));
router.get('/nudges/journeys', asyncHandler(nudgeAdmin.listJourneys));
router.patch('/nudges/journeys/:id', nudgeAdmin.validateIdParams, nudgeAdmin.validateJourneyPatch, asyncHandler(nudgeAdmin.patchJourney));
router.post('/nudges/test-send', nudgeAdmin.validateTestSendBody, asyncHandler(nudgeAdmin.testSend));
// Sailee's message box: one couple, one note → in-app + push + WhatsApp.
router.post('/nudges/send-note', nudgeAdmin.validateSendNoteBody, asyncHandler(nudgeAdmin.sendNote));
router.get('/nudges/deliveries', nudgeAdmin.validateDeliveriesQuery, asyncHandler(nudgeAdmin.deliveries));

export default router;
