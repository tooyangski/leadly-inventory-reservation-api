import { describe, it, expect } from 'vitest';
import { createItemSchema } from '../../src/validation/items';
import { createReservationSchema } from '../../src/validation/reservations';

describe('createItemSchema', () => {
  it('rejects zero or negative initial_quantity', () => {
    expect(createItemSchema.safeParse({ name: 'X', initial_quantity: 0 }).success).toBe(false);
    expect(createItemSchema.safeParse({ name: 'X', initial_quantity: -1 }).success).toBe(false);
  });

  it('accepts a valid payload', () => {
    expect(createItemSchema.safeParse({ name: 'X', initial_quantity: 5 }).success).toBe(true);
  });
});

describe('createReservationSchema', () => {
  it('rejects a non-uuid item_id', () => {
    expect(
      createReservationSchema.safeParse({ item_id: 'not-a-uuid', customer_id: 'c1', quantity: 1 }).success
    ).toBe(false);
  });

  it('accepts a valid payload', () => {
    expect(
      createReservationSchema.safeParse({
        item_id: '11111111-1111-1111-1111-111111111111',
        customer_id: 'c1',
        quantity: 1,
      }).success
    ).toBe(true);
  });
});
