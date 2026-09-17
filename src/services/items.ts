import { pool } from '../db/pool';
import { insertItem, findItemById, getItemAggregates } from '../db/items';
import { NotFoundError } from '../errors';

export async function createItem(params: { name: string; totalQuantity: number }) {
  const item = await insertItem(pool, params);
  return {
    id: item.id,
    name: item.name,
    total_quantity: item.total_quantity,
    created_at: item.created_at,
  };
}

export async function getItemStatus(id: string) {
  const item = await findItemById(pool, id);
  if (!item) throw new NotFoundError(`Item ${id} not found`);

  const { held, confirmed } = await getItemAggregates(pool, id);
  return {
    id: item.id,
    name: item.name,
    total_quantity: item.total_quantity,
    available_quantity: item.total_quantity - held - confirmed,
    held_quantity: held,
    confirmed_quantity: confirmed,
  };
}
