import { Request, Response } from 'express';
import { sendSuccess } from '../utils/response';
import { AppError } from '../utils/AppError';

export const getSuggestions = async (req: Request, res: Response): Promise<void> => {
  if (!req.user) throw new AppError('Unauthorized', 401);
  // TODO Phase 3: matching algorithm based on couple answers & preferences
  sendSuccess({ res, data: { suggestions: [] }, message: 'Suggestions fetched [stub]' });
};

export const getAcceptedMatches = async (req: Request, res: Response): Promise<void> => {
  if (!req.user) throw new AppError('Unauthorized', 401);
  // TODO Phase 3
  sendSuccess({ res, data: { matches: [] }, message: 'Accepted matches [stub]' });
};

export const acceptMatch = async (req: Request, res: Response): Promise<void> => {
  if (!req.user) throw new AppError('Unauthorized', 401);
  const { matchId } = req.params;
  // TODO Phase 3: update Match status, emit socket event
  sendSuccess({ res, data: { matchId }, message: 'Match accepted [stub]' });
};

export const rejectMatch = async (req: Request, res: Response): Promise<void> => {
  if (!req.user) throw new AppError('Unauthorized', 401);
  const { matchId } = req.params;
  // TODO Phase 3: update Match status
  sendSuccess({ res, data: { matchId }, message: 'Match rejected [stub]' });
};
