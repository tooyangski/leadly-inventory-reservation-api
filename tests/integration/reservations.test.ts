import { describe, it, expect, afterEach, afterAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app';
import { resetDb, closeDb } from './testDb';
import { pool } from '../../src/db/pool';

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

describe('reservation lifecycle', () => {
  it('reserves, then confirms, permanently reducing availability', async () => {
    const itemId = await createItem(5);
    const reserveRes = await request(app)
      .post('/v1/reservations')
      .send({ item_id: itemId, customer_id: 'c1', quantity: 2 });

    const confirmRes = await request(app).post(`/v1/reservations/${reserveRes.body.id}/confirm`);
    expect(confirmRes.status).toBe(200);
    expect(confirmRes.body.status).toBe('CONFIRMED');

    const status = await request(app).get(`/v1/items/${itemId}`);
    expect(status.body).toMatchObject({ available_quantity: 3, held_quantity: 0, confirmed_quantity: 2 });
  });

  it('cancelling releases the held quantity back to availability', async () => {
    const itemId = await createItem(5);
    const reserveRes = await request(app)
      .post('/v1/reservations')
      .send({ item_id: itemId, customer_id: 'c1', quantity: 2 });
    await request(app).post(`/v1/reservations/${reserveRes.body.id}/cancel`);

    const status = await request(app).get(`/v1/items/${itemId}`);
    expect(status.body).toMatchObject({ available_quantity: 5, held_quantity: 0 });
  });

  it('confirming twice is idempotent and does not double-deduct', async () => {
    const itemId = await createItem(5);
    const reserveRes = await request(app)
      .post('/v1/reservations')
      .send({ item_id: itemId, customer_id: 'c1', quantity: 2 });

    const first = await request(app).post(`/v1/reservations/${reserveRes.body.id}/confirm`);
    const second = await request(app).post(`/v1/reservations/${reserveRes.body.id}/confirm`);
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(second.body.status).toBe('CONFIRMED');

    const status = await request(app).get(`/v1/items/${itemId}`);
    expect(status.body.confirmed_quantity).toBe(2);
  });

  it('cancelling twice is idempotent and does not double-release', async () => {
    const itemId = await createItem(5);
    const reserveRes = await request(app)
      .post('/v1/reservations')
      .send({ item_id: itemId, customer_id: 'c1', quantity: 2 });

    const first = await request(app).post(`/v1/reservations/${reserveRes.body.id}/cancel`);
    const second = await request(app).post(`/v1/reservations/${reserveRes.body.id}/cancel`);
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);

    const status = await request(app).get(`/v1/items/${itemId}`);
    expect(status.body.available_quantity).toBe(5);
  });

  it('cancelling after confirmation does not increase availability', async () => {
    const itemId = await createItem(5);
    const reserveRes = await request(app)
      .post('/v1/reservations')
      .send({ item_id: itemId, customer_id: 'c1', quantity: 2 });
    await request(app).post(`/v1/reservations/${reserveRes.body.id}/confirm`);

    const cancelRes = await request(app).post(`/v1/reservations/${reserveRes.body.id}/cancel`);
    expect(cancelRes.status).toBe(409);

    const status = await request(app).get(`/v1/items/${itemId}`);
    expect(status.body).toMatchObject({ available_quantity: 3, confirmed_quantity: 2 });
  });

  it('confirming after expiration does not deduct inventory', async () => {
    const itemId = await createItem(5);
    const reserveRes = await request(app)
      .post('/v1/reservations')
      .send({ item_id: itemId, customer_id: 'c1', quantity: 2 });

    await pool.query(`UPDATE reservations SET expires_at = now() - interval '1 minute' WHERE id = $1`, [
      reserveRes.body.id,
    ]);

    const confirmRes = await request(app).post(`/v1/reservations/${reserveRes.body.id}/confirm`);
    expect(confirmRes.status).toBe(409);
    expect(confirmRes.body.error.code).toBe('RESERVATION_EXPIRED');

    const status = await request(app).get(`/v1/items/${itemId}`);
    expect(status.body.available_quantity).toBe(5);
    expect(status.body.held_quantity).toBe(0);
  });
});
