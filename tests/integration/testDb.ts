import { pool } from '../../src/db/pool';

export async function resetDb(): Promise<void> {
  await pool.query('TRUNCATE reservations, items RESTART IDENTITY CASCADE');
}

export async function closeDb(): Promise<void> {
  await pool.end();
}
