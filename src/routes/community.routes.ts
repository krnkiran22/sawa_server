import { Router } from 'express';
import { authenticate } from '../middleware/authenticate';
import { asyncHandler } from '../utils/asyncHandler';
import {
  listCommunities,
  createCommunity,
  getCommunity,
  joinCommunity,
  leaveCommunity,
  myCommunities,
} from '../controllers/community.controller';

const router = Router();

router.use(authenticate);

// GET /api/v1/communities
router.get('/', asyncHandler(listCommunities));

// GET /api/v1/communities/mine
router.get('/mine', asyncHandler(myCommunities));

// POST /api/v1/communities
router.post('/', asyncHandler(createCommunity));

// GET /api/v1/communities/:id
router.get('/:id', asyncHandler(getCommunity));

// POST /api/v1/communities/:id/join
router.post('/:id/join', asyncHandler(joinCommunity));

// POST /api/v1/communities/:id/leave
router.post('/:id/leave', asyncHandler(leaveCommunity));

export default router;
