import { describe, it, expect } from 'vitest';
import app from '../../api/index';

describe('Vercel entry point', () => {
  it('exports the Express app as a callable request handler', () => {
    expect(typeof app).toBe('function');
  });
});
