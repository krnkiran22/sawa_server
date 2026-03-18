import { Response } from 'express';

interface SuccessPayload<T = unknown> {
  res: Response;
  data?: T;
  message?: string;
  statusCode?: number;
}

interface ErrorPayload {
  res: Response;
  error: string;
  code?: string | number;
  statusCode?: number;
}

/**
 * Send a successful JSON response.
 *
 * Shape: { success: true, data, message }
 */
export const sendSuccess = <T = unknown>({
  res,
  data = {} as T,
  message = 'OK',
  statusCode = 200,
}: SuccessPayload<T>): void => {
  res.status(statusCode).json({ success: true, data, message });
};

/**
 * Send an error JSON response.
 *
 * Shape: { success: false, error, code }
 */
export const sendError = ({
  res,
  error,
  code,
  statusCode = 500,
}: ErrorPayload): void => {
  res.status(statusCode).json({ success: false, error, code });
};
