import { describe, it, expect, vi } from 'vitest';
import { z } from 'zod';
import { validateBody } from '../../src/middleware/validate';
import { ValidationError } from '../../src/errors';

describe('validateBody', () => {
  const schema = z.object({ name: z.string().min(1) });

  it('calls next with no error when body is valid', () => {
    const req: any = { body: { name: 'Widget' } };
    const next = vi.fn();
    validateBody(schema)(req, {} as any, next);
    expect(next).toHaveBeenCalledWith();
    expect(req.body).toEqual({ name: 'Widget' });
  });

  it('calls next with a ValidationError when body is invalid', () => {
    const req: any = { body: {} };
    const next = vi.fn();
    validateBody(schema)(req, {} as any, next);
    expect(next).toHaveBeenCalledWith(expect.any(ValidationError));
  });
});
