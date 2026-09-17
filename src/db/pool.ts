import 'dotenv/config';
import { Pool } from 'pg';

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 10,
  connectionTimeoutMillis: 5000,
  idleTimeoutMillis: 10000,
});

// node-postgres emits 'error' on the pool when an idle client's connection is
// dropped by the backend (routine against a pooler like Supabase's pgbouncer).
// Without a listener, Node treats this as an unhandled error and can crash the process.
pool.on('error', (err) => {
  console.error('Unexpected idle client error', err);
});
