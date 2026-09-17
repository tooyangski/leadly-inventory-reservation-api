import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app';

const app = createApp();

describe('API documentation', () => {
  it('serves the OpenAPI document as JSON', async () => {
    const res = await request(app).get('/openapi.json');
    expect(res.status).toBe(200);
    expect(res.body.openapi).toBe('3.0.3');

    const requiredPaths = [
      '/v1/items',
      '/v1/items/{id}',
      '/v1/reservations',
      '/v1/reservations/{id}/confirm',
      '/v1/reservations/{id}/cancel',
      '/v1/maintenance/expire-reservations',
    ];
    for (const path of requiredPaths) {
      expect(res.body.paths).toHaveProperty(path);
    }
  });

  it('serves Swagger UI', async () => {
    const res = await request(app).get('/docs/');
    expect(res.status).toBe(200);
    expect(res.text).toContain('swagger-ui');
  });
});
