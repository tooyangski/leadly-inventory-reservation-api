import { describe, it, expect, afterEach, afterAll } from 'vitest';
import { pool } from '../../src/db/pool';
import { withTransaction } from '../../src/db/withTransaction';
import { insertItem, lockItemById, getItemAggregates } from '../../src/db/items';
import {
  insertReservation,
  confirmPendingReservation,
  cancelPendingReservation,
  expireStaleReservations,
} from '../../src/db/reservations';
import { resetDb, closeDb } from './testDb';

afterEach(resetDb);
afterAll(closeDb);

describe('items data access', () => {
  it('inserts an item and reads it back', async () => {
    const item = await insertItem(pool, { name: 'Widget', totalQuantity: 10 });
    expect(item.name).toBe('Widget');
    expect(item.total_quantity).toBe(10);
  });

  it('aggregates held and confirmed quantities correctly, excluding expired and cancelled reservations', async () => {
    const item = await insertItem(pool, { name: 'Widget', totalQuantity: 10 });
    const future = new Date(Date.now() + 60_000);
    const past = new Date(Date.now() - 60_000);

    await insertReservation(pool, { itemId: item.id, customerId: 'a', quantity: 2, expiresAt: future });
    const confirmedRes = await insertReservation(pool, { itemId: item.id, customerId: 'b', quantity: 1, expiresAt: future });
    await confirmPendingReservation(pool, confirmedRes.id);
    const cancelledRes = await insertReservation(pool, { itemId: item.id, customerId: 'c', quantity: 3, expiresAt: future });
    await cancelPendingReservation(pool, cancelledRes.id);
    await insertReservation(pool, { itemId: item.id, customerId: 'd', quantity: 4, expiresAt: past });

    const aggregates = await getItemAggregates(pool, item.id);
    expect(aggregates.held).toBe(2);
    expect(aggregates.confirmed).toBe(1);
  });
});

describe('reservation locking', () => {
  it('locks the item row for update within a transaction', async () => {
    const item = await insertItem(pool, { name: 'Widget', totalQuantity: 5 });
    const locked = await withTransaction(async (client) => lockItemById(client, item.id));
    expect(locked?.id).toBe(item.id);
  });
});

describe('expireStaleReservations', () => {
  it('expires only pending reservations whose expiry has passed', async () => {
    const item = await insertItem(pool, { name: 'Widget', totalQuantity: 5 });
    const past = new Date(Date.now() - 60_000);
    const future = new Date(Date.now() + 60_000);
    const stale = await insertReservation(pool, { itemId: item.id, customerId: 'a', quantity: 1, expiresAt: past });
    const fresh = await insertReservation(pool, { itemId: item.id, customerId: 'b', quantity: 1, expiresAt: future });

    const expired = await expireStaleReservations(pool);
    const expiredIds = expired.map((r) => r.id);
    expect(expiredIds).toContain(stale.id);
    expect(expiredIds).not.toContain(fresh.id);
  });
});
