import { Queryable, ItemRow } from './types';

export async function insertItem(
  db: Queryable,
  params: { name: string; totalQuantity: number }
): Promise<ItemRow> {
  const result = await db.query<ItemRow>(
    `INSERT INTO items (name, total_quantity) VALUES ($1, $2) RETURNING *`,
    [params.name, params.totalQuantity]
  );
  return result.rows[0];
}

export async function findItemById(db: Queryable, id: string): Promise<ItemRow | null> {
  const result = await db.query<ItemRow>(`SELECT * FROM items WHERE id = $1`, [id]);
  return result.rows[0] ?? null;
}

export async function lockItemById(db: Queryable, id: string): Promise<ItemRow | null> {
  const result = await db.query<ItemRow>(`SELECT * FROM items WHERE id = $1 FOR UPDATE`, [id]);
  return result.rows[0] ?? null;
}

export interface ItemAggregates {
  held: number;
  confirmed: number;
}

export async function getItemAggregates(db: Queryable, itemId: string): Promise<ItemAggregates> {
  const result = await db.query<{ held: string; confirmed: string }>(
    `SELECT
       COALESCE(SUM(quantity) FILTER (WHERE status = 'PENDING' AND expires_at > now()), 0) AS held,
       COALESCE(SUM(quantity) FILTER (WHERE status = 'CONFIRMED'), 0) AS confirmed
     FROM reservations
     WHERE item_id = $1`,
    [itemId]
  );
  return {
    held: Number(result.rows[0].held),
    confirmed: Number(result.rows[0].confirmed),
  };
}
