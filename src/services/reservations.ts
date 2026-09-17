import { pool } from '../db/pool';
import { withTransaction } from '../db/withTransaction';
import { lockItemById, getItemAggregates } from '../db/items';
import { insertReservation } from '../db/reservations';
import { confirmPendingReservation, cancelPendingReservation, findReservationById } from '../db/reservations';
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

export async function confirmReservation(id: string) {
  const confirmed = await confirmPendingReservation(pool, id);
  if (confirmed) return confirmed;

  const existing = await findReservationById(pool, id);
  if (!existing) throw new NotFoundError(`Reservation ${id} not found`);
  if (existing.status === 'CONFIRMED') return existing;
  if (existing.status === 'PENDING' && new Date(existing.expires_at).getTime() <= Date.now()) {
    throw new ConflictError('RESERVATION_EXPIRED', `Reservation ${id} has expired and cannot be confirmed`);
  }
  throw new ConflictError('INVALID_STATE', `Reservation ${id} is ${existing.status} and cannot be confirmed`);
}

export async function cancelReservation(id: string) {
  const cancelled = await cancelPendingReservation(pool, id);
  if (cancelled) return cancelled;

  const existing = await findReservationById(pool, id);
  if (!existing) throw new NotFoundError(`Reservation ${id} not found`);
  if (existing.status === 'CANCELLED') return existing;
  throw new ConflictError('INVALID_STATE', `Reservation ${id} is ${existing.status} and cannot be cancelled`);
}
