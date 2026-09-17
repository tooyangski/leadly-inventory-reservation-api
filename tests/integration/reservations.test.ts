import { describe, it, expect, afterEach, afterAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app';
import { resetDb, closeDb } from './testDb';

const app = createApp();

afterEach(resetDb);
afterAll(closeDb);

async function createItem(quantity: number) {
  const res = await request(app).post('/v1/items').send({ name: 'Item', initial_quantity: quantity });
  return res.body.id as string;
}

describe('POST /v1/reservations', () => {
  it('creates a PENDING reservation with an expiry in the future', async () => {
    const itemId = await createItem(5);
    const res = await request(app)
      .post('/v1/reservations')
      .send({ item_id: itemId, customer_id: 'c1', quantity: 2 });

    expect(res.status).toBe(201);
    expect(res.body.status).toBe('PENDING');
    expect(new Date(res.body.expires_at).getTime()).toBeGreaterThan(Date.now());
  });

  it('rejects a reservation when insufficient quantity is available', async () => {
    const itemId = await createItem(2);
    const res = await request(app)
      .post('/v1/reservations')
      .send({ item_id: itemId, customer_id: 'c1', quantity: 3 });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('INSUFFICIENT_AVAILABILITY');
  });

  it('returns 404 when the item does not exist', async () => {
    const res = await request(app)
      .post('/v1/reservations')
      .send({ item_id: '11111111-1111-1111-1111-111111111111', customer_id: 'c1', quantity: 1 });

    expect(res.status).toBe(404);
  });
});
