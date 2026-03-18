import { Request, Response, NextFunction } from 'express';
import { verifyAccessToken } from '../utils/jwt';
import { AppError } from '../utils/AppError';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: {
        userId: string;
        coupleId?: string;
      };
    }
  }
}

/**
 * Middleware: Validates JWT Bearer token and attaches user payload to req.user.
 * Add to any protected route.
 */
export const authenticate = (
  req: Request,
  _res: Response,
  next: NextFunction,
): void => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return next(new AppError('Authorization header missing', 401, 'UNAUTHORIZED'));
  }

  const token = authHeader.split(' ')[1];

  if (!token) {
    return next(new AppError('Token missing', 401, 'UNAUTHORIZED'));
  }

  const payload = verifyAccessToken(token);
  req.user = { userId: payload.userId, coupleId: payload.coupleId };
  next();
};
