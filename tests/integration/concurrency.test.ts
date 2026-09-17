import { describe, it, expect, afterEach, afterAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app';
import { resetDb, closeDb } from './testDb';

const app = createApp();

afterEach(resetDb);
afterAll(closeDb);

describe('concurrent reservations', () => {
  it('never oversells when many requests race for the same limited stock', async () => {
    const created = await request(app).post('/v1/items').send({ name: 'Limited Item', initial_quantity: 5 });
    const itemId = created.body.id as string;

    const attempts = Array.from({ length: 10 }, (_, i) =>
      request(app)
        .post('/v1/reservations')
        .send({ item_id: itemId, customer_id: `customer-${i}`, quantity: 1 })
    );
    const results = await Promise.all(attempts);

    const succeeded = results.filter((r) => r.status === 201);
    const rejected = results.filter((r) => r.status === 409);
    expect(succeeded).toHaveLength(5);
    expect(rejected).toHaveLength(5);

    const status = await request(app).get(`/v1/items/${itemId}`);
    expect(status.body.available_quantity).toBe(0);
    expect(status.body.held_quantity).toBe(5);
  });
});
