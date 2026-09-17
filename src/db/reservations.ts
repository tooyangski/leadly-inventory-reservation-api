import { Queryable, ReservationRow } from './types';

export async function insertReservation(
  db: Queryable,
  params: { itemId: string; customerId: string; quantity: number; expiresAt: Date }
): Promise<ReservationRow> {
  const result = await db.query<ReservationRow>(
    `INSERT INTO reservations (item_id, customer_id, quantity, expires_at)
     VALUES ($1, $2, $3, $4) RETURNING *`,
    [params.itemId, params.customerId, params.quantity, params.expiresAt]
  );
  return result.rows[0];
}

export async function findReservationById(db: Queryable, id: string): Promise<ReservationRow | null> {
  const result = await db.query<ReservationRow>(`SELECT * FROM reservations WHERE id = $1`, [id]);
  return result.rows[0] ?? null;
}

export async function confirmPendingReservation(db: Queryable, id: string): Promise<ReservationRow | null> {
  const result = await db.query<ReservationRow>(
    `UPDATE reservations SET status = 'CONFIRMED'
     WHERE id = $1 AND status = 'PENDING' AND expires_at > now()
     RETURNING *`,
    [id]
  );
  return result.rows[0] ?? null;
}

export async function cancelPendingReservation(db: Queryable, id: string): Promise<ReservationRow | null> {
  const result = await db.query<ReservationRow>(
    `UPDATE reservations SET status = 'CANCELLED'
     WHERE id = $1 AND status = 'PENDING'
     RETURNING *`,
    [id]
  );
  return result.rows[0] ?? null;
}

export async function expireStaleReservations(db: Queryable): Promise<ReservationRow[]> {
  const result = await db.query<ReservationRow>(
    `UPDATE reservations SET status = 'EXPIRED'
     WHERE status = 'PENDING' AND expires_at <= now()
     RETURNING *`
  );
  return result.rows;
}
