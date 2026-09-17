import { describe, it, expect, vi } from 'vitest';
import { errorHandler } from '../../src/middleware/errorHandler';
import { NotFoundError, ConflictError, ValidationError } from '../../src/errors';

function mockRes() {
  const res: any = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res;
}

describe('errorHandler', () => {
  it('maps NotFoundError to 404', () => {
    const res = mockRes();
    errorHandler(new NotFoundError('missing'), {} as any, res, vi.fn());
    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({ error: { code: 'NOT_FOUND', message: 'missing' } });
  });

  it('maps ConflictError to 409', () => {
    const res = mockRes();
    errorHandler(new ConflictError('INSUFFICIENT_AVAILABILITY', 'no stock'), {} as any, res, vi.fn());
    expect(res.status).toHaveBeenCalledWith(409);
  });

  it('maps ValidationError to 400', () => {
    const res = mockRes();
    errorHandler(new ValidationError('bad input'), {} as any, res, vi.fn());
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('maps unknown errors to 500', () => {
    const res = mockRes();
    errorHandler(new Error('boom'), {} as any, res, vi.fn());
    expect(res.status).toHaveBeenCalledWith(500);
  });
});
