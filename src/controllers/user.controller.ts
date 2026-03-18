import { Request, Response } from 'express';
import { sendSuccess } from '../utils/response';
import { AppError } from '../utils/AppError';

/**
 * GET /api/v1/users/me
 */
export const getMe = async (req: Request, res: Response): Promise<void> => {
  if (!req.user) throw new AppError('Unauthorized', 401);
  // TODO Phase 1: fetch user from DB by req.user.userId
  sendSuccess({ res, data: { userId: req.user.userId }, message: 'User fetched [stub]' });
};

/**
 * PATCH /api/v1/users/me
 */
export const updateMe = async (req: Request, res: Response): Promise<void> => {
  if (!req.user) throw new AppError('Unauthorized', 401);
  // TODO Phase 2: validate body, update User document
  sendSuccess({ res, message: 'User updated [stub]' });
};
