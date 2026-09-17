import { ErrorRequestHandler } from 'express';
import { AppError, ValidationError, NotFoundError, ConflictError } from '../errors';

function statusFor(err: AppError): number {
  if (err instanceof ValidationError) return 400;
  if (err instanceof NotFoundError) return 404;
  if (err instanceof ConflictError) return 409;
  return 500;
}

export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof AppError) {
    res.status(statusFor(err)).json({ error: { code: err.code, message: err.message } });
    return;
  }

  const status = (err as { status?: unknown; statusCode?: unknown })?.status ?? (err as { statusCode?: unknown })?.statusCode;
  if (typeof status === 'number' && status >= 400 && status < 500) {
    res.status(status).json({ error: { code: 'BAD_REQUEST', message: (err as Error)?.message ?? 'Bad request' } });
    return;
  }

  console.error(err);
  res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Unexpected error' } });
};
