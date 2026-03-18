import { Router } from 'express';
import { authenticate } from '../middleware/authenticate';
import { asyncHandler } from '../utils/asyncHandler';
import {
  getSuggestions,
  acceptMatch,
  rejectMatch,
  getAcceptedMatches,
} from '../controllers/match.controller';

const router = Router();

router.use(authenticate);

// GET /api/v1/matches  — suggested couples
router.get('/', asyncHandler(getSuggestions));

// GET /api/v1/matches/accepted
router.get('/accepted', asyncHandler(getAcceptedMatches));

// POST /api/v1/matches/:matchId/accept
router.post('/:matchId/accept', asyncHandler(acceptMatch));

// POST /api/v1/matches/:matchId/reject
router.post('/:matchId/reject', asyncHandler(rejectMatch));

export default router;
