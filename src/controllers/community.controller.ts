import { Request, Response } from 'express';
import { sendSuccess } from '../utils/response';
import { AppError } from '../utils/AppError';

export const listCommunities = async (req: Request, res: Response): Promise<void> => {
  if (!req.user) throw new AppError('Unauthorized', 401);
  sendSuccess({ res, data: { communities: [] }, message: 'Communities listed [stub]' });
};

export const myCommunities = async (req: Request, res: Response): Promise<void> => {
  if (!req.user) throw new AppError('Unauthorized', 401);
  sendSuccess({ res, data: { communities: [] }, message: 'My communities [stub]' });
};

export const createCommunity = async (req: Request, res: Response): Promise<void> => {
  if (!req.user) throw new AppError('Unauthorized', 401);
  sendSuccess({ res, message: 'Community created [stub]', statusCode: 201 });
};

export const getCommunity = async (req: Request, res: Response): Promise<void> => {
  if (!req.user) throw new AppError('Unauthorized', 401);
  const { id } = req.params;
  sendSuccess({ res, data: { id }, message: 'Community fetched [stub]' });
};

export const joinCommunity = async (req: Request, res: Response): Promise<void> => {
  if (!req.user) throw new AppError('Unauthorized', 401);
  const { id } = req.params;
  sendSuccess({ res, data: { id }, message: 'Joined community [stub]' });
};

export const leaveCommunity = async (req: Request, res: Response): Promise<void> => {
  if (!req.user) throw new AppError('Unauthorized', 401);
  const { id } = req.params;
  sendSuccess({ res, data: { id }, message: 'Left community [stub]' });
};
