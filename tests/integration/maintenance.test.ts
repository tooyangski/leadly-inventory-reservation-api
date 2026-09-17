import { describe, it, expect, afterEach, afterAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app';
import { pool } from '../../src/db/pool';
import { resetDb, closeDb } from './testDb';

const app = createApp();

afterEach(resetDb);
afterAll(closeDb);

describe('POST /v1/maintenance/expire-reservations', () => {
  it('marks expired pending reservations as EXPIRED and frees their quantity', async () => {
    const created = await request(app).post('/v1/items').send({ name: 'Item', initial_quantity: 5 });
    const itemId = created.body.id as string;
    const reserveRes = await request(app)
      .post('/v1/reservations')
      .send({ item_id: itemId, customer_id: 'c1', quantity: 2 });

    await pool.query(`UPDATE reservations SET expires_at = now() - interval '1 minute' WHERE id = $1`, [
      reserveRes.body.id,
    ]);

    const expireRes = await request(app).post('/v1/maintenance/expire-reservations');
    expect(expireRes.status).toBe(200);
    expect(expireRes.body.expired_ids).toContain(reserveRes.body.id);

    const status = await request(app).get(`/v1/items/${itemId}`);
    expect(status.body.available_quantity).toBe(5);
  });

  it('leaves non-expired pending reservations untouched', async () => {
    const created = await request(app).post('/v1/items').send({ name: 'Item', initial_quantity: 5 });
    const itemId = created.body.id as string;
    const reserveRes = await request(app)
      .post('/v1/reservations')
      .send({ item_id: itemId, customer_id: 'c1', quantity: 2 });

    const expireRes = await request(app).post('/v1/maintenance/expire-reservations');
    expect(expireRes.body.expired_ids).not.toContain(reserveRes.body.id);

    const status = await request(app).get(`/v1/items/${itemId}`);
    expect(status.body.held_quantity).toBe(2);
  });
});
