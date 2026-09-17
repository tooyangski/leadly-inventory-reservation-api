import { pool } from '../db/pool';
import { withTransaction } from '../db/withTransaction';
import { lockItemById, getItemAggregates } from '../db/items';
import { insertReservation } from '../db/reservations';
import { NotFoundError, ConflictError } from '../errors';

const RESERVATION_TTL_MINUTES = Number(process.env.RESERVATION_TTL_MINUTES ?? 10);

export async function createReservation(params: { itemId: string; customerId: string; quantity: number }) {
  return withTransaction(async (client) => {
    const item = await lockItemById(client, params.itemId);
    if (!item) throw new NotFoundError(`Item ${params.itemId} not found`);

    const { held, confirmed } = await getItemAggregates(client, params.itemId);
    const available = item.total_quantity - held - confirmed;
    if (available < params.quantity) {
      throw new ConflictError('INSUFFICIENT_AVAILABILITY', `Only ${available} units available`);
    }

    const expiresAt = new Date(Date.now() + RESERVATION_TTL_MINUTES * 60_000);
    return insertReservation(client, {
      itemId: params.itemId,
      customerId: params.customerId,
      quantity: params.quantity,
      expiresAt,
    });
  });
}

// Note: `pool` is imported here so later steps in this task (confirm/cancel, added in Task 7)
// can share the module — it is unused by `createReservation` itself, which always runs inside
// `withTransaction`. Leave the import in place; Task 7 will use it.
