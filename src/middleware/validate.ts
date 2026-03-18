import { Request, Response, NextFunction } from 'express';
import { ZodSchema, ZodError } from 'zod';
import { AppError } from '../utils/AppError';

type ValidationTarget = 'body' | 'query' | 'params';

/**
 * Middleware factory for Zod schema validation.
 *
 * Usage:
 *   router.post('/path', validate(MySchema), myController);
 *   router.get('/path', validate(MyQuerySchema, 'query'), myController);
 */
export const validate =
  (schema: ZodSchema, target: ValidationTarget = 'body') =>
  (req: Request, _res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req[target]);

    if (!result.success) {
      const message = formatZodErrors(result.error);
      return next(new AppError(message, 400, 'VALIDATION_ERROR'));
    }

    // Replace with parsed/coerced data
    req[target] = result.data;
    next();
  };

const formatZodErrors = (error: ZodError): string => {
  return error.errors
    .map((e) => `${e.path.join('.')}: ${e.message}`)
    .join('; ');
};
