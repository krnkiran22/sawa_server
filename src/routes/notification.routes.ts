import { Router } from 'express';
import { authenticate } from '../middleware/authenticate';
import { asyncHandler } from '../utils/asyncHandler';
import { getNotifications, markAsRead, getUnreadCount } from '../controllers/notification.controller';

const router = Router();

router.use(authenticate);

// GET /api/v1/notifications
router.get('/', asyncHandler(getNotifications));

// GET /api/v1/notifications/unread-count
router.get('/unread-count', asyncHandler(getUnreadCount));

// PATCH /api/v1/notifications/:id/read
router.patch('/:id/read', asyncHandler(markAsRead));

export default router;
