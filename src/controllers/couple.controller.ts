import { Request, Response } from 'express';
import { sendSuccess } from '../utils/response';
import { AppError } from '../utils/AppError';

export const createCouple = async (req: Request, res: Response): Promise<void> => {
  if (!req.user) throw new AppError('Unauthorized', 401);
  // TODO Phase 2
  sendSuccess({ res, message: 'Couple created [stub]', statusCode: 201 });
};

export const getMyCouple = async (req: Request, res: Response): Promise<void> => {
  if (!req.user) throw new AppError('Unauthorized', 401);
  // TODO Phase 2
  sendSuccess({ res, data: {}, message: 'Couple fetched [stub]' });
};

export const updateMyCouple = async (req: Request, res: Response): Promise<void> => {
  if (!req.user) throw new AppError('Unauthorized', 401);
  // TODO Phase 2
  sendSuccess({ res, message: 'Couple updated [stub]' });
};

export const submitAnswers = async (req: Request, res: Response): Promise<void> => {
  if (!req.user) throw new AppError('Unauthorized', 401);
  // TODO Phase 2: persist onboarding questionnaire answers to Couple.answers
  sendSuccess({ res, message: 'Answers submitted [stub]' });
};

export const invitePartner = async (req: Request, res: Response): Promise<void> => {
  if (!req.user) throw new AppError('Unauthorized', 401);
  // TODO Phase 2: generate unique invite code / deep link
  sendSuccess({ res, data: { inviteCode: 'stub-code' }, message: 'Invite generated [stub]' });
};
