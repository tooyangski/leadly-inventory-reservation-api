import { RequestHandler } from 'express';
import { ZodSchema } from 'zod';
import { ValidationError } from '../errors';

export const validateBody = (schema: ZodSchema): RequestHandler => (req, _res, next) => {
  const result = schema.safeParse(req.body);
  if (!result.success) {
    next(new ValidationError(result.error.issues.map((i) => i.message).join('; ')));
    return;
  }
  req.body = result.data;
  next();
};
