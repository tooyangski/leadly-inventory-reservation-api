import { describe, it, expect, afterEach, afterAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app';
import { resetDb, closeDb } from './testDb';

const app = createApp();

afterEach(resetDb);
afterAll(closeDb);

describe('POST /v1/items', () => {
  it('creates an item and returns its id, name, and total quantity', async () => {
    const res = await request(app).post('/v1/items').send({ name: 'White T-Shirt', initial_quantity: 5 });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ name: 'White T-Shirt', total_quantity: 5 });
    expect(res.body.id).toBeTypeOf('string');
  });

  it('rejects a non-positive initial_quantity', async () => {
    const res = await request(app).post('/v1/items').send({ name: 'X', initial_quantity: 0 });
    expect(res.status).toBe(400);
  });
});

describe('GET /v1/items/:id', () => {
  it('returns total, available, held, and confirmed quantities', async () => {
    const created = await request(app).post('/v1/items').send({ name: 'Mug', initial_quantity: 10 });
    const res = await request(app).get(`/v1/items/${created.body.id}`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      total_quantity: 10,
      available_quantity: 10,
      held_quantity: 0,
      confirmed_quantity: 0,
    });
  });

  it('returns 404 for an unknown item', async () => {
    const res = await request(app).get('/v1/items/11111111-1111-1111-1111-111111111111');
    expect(res.status).toBe(404);
  });
});
