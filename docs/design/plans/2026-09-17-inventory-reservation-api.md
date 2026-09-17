# Inventory Reservation API Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers-extended-cc:subagent-driven-development (recommended) or superpowers-extended-cc:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Inventory Reservation API — an Express + TypeScript backend on Supabase/Postgres that lets customers hold, confirm, cancel, and expire inventory reservations without ever overselling, even under concurrent requests.

**Architecture:** Layered `routes → services → db`, one-way dependencies only. Availability is never stored as a mutable counter — it's always derived from the `reservations` table (`total_quantity − held − confirmed`), which eliminates an entire class of counter-drift bugs. Concurrency safety comes from a `SELECT ... FOR UPDATE` row lock on the item during reservation creation, and from conditional `UPDATE ... WHERE status = 'PENDING'` statements for confirm/cancel/expire, which are naturally idempotent and retry-safe.

**Tech Stack:** Express.js, TypeScript, raw `pg` (node-postgres, no ORM), zod, swagger-ui-express, Vitest + supertest, Docker Compose (local test Postgres), Vercel (deployment target), npm.

**Spec:** `docs/design/specs/2026-09-17-inventory-reservation-api-design.md`

## Global Constraints

- Error response shape is always exactly: `{ "error": { "code": string, "message": string } }`. No endpoint may deviate from this on any failure path.
- Reservation status is exactly one of `'PENDING' | 'CONFIRMED' | 'CANCELLED' | 'EXPIRED'` — backed by the Postgres `reservation_status` ENUM. Use these literal strings verbatim everywhere (code, tests, API responses).
- Endpoint paths/methods are fixed exactly as: `POST /v1/items`, `GET /v1/items/:id`, `POST /v1/reservations`, `POST /v1/reservations/:id/confirm`, `POST /v1/reservations/:id/cancel`, `POST /v1/maintenance/expire-reservations`.
- Availability is always *derived* (`total_quantity - held - confirmed`, computed from `reservations` rows). Never introduce a stored/mutable `available_quantity` column on `items`.
- All database access goes through raw SQL via `pg` in `src/db/*`. No ORM or query builder.
- No authentication, no rate limiting — out of scope per the assignment.

**User decisions (already made):** raw `pg` (no ORM); Vitest with unit + integration + an automated concurrency test; Docker Compose for the local test Postgres; npm as package manager; build for genuine quality rather than simulating a literal 4-hour timebox; `git init` locally only, no push; Supabase project creation and `vercel deploy` are the user's own steps — do not attempt to run either.

---

### Task 1: Project Scaffolding & Tooling

**Goal:** Set up the npm project, TypeScript config, and test runner config so every later task has a place to add real code.

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `.gitignore`
- Create: `.env.example`
- Create: `vitest.config.ts`

**Acceptance Criteria:**
- [ ] `npm install` completes with no errors.
- [ ] `.env.example` documents `DATABASE_URL`, `PORT`, and `RESERVATION_TTL_MINUTES`.
- [ ] `.gitignore` excludes `node_modules`, `dist`, and `.env`.

**Verify:** `npm install` → exits 0, creates `node_modules/` and `package-lock.json`.

**Steps:**

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "leadly-inventory-reservation-api",
  "version": "1.0.0",
  "private": true,
  "scripts": {
    "dev": "tsx watch src/server.ts",
    "build": "tsc -p tsconfig.json",
    "start": "node dist/src/server.js",
    "db:up": "docker compose up -d",
    "db:down": "docker compose down",
    "db:migrate": "tsx scripts/migrate.ts",
    "test:unit": "vitest run tests/unit",
    "test:integration": "vitest run tests/integration",
    "test": "npm run test:unit",
    "demo:concurrency": "tsx scripts/concurrency-demo.ts"
  },
  "dependencies": {
    "dotenv": "^16.4.5",
    "express": "^4.19.2",
    "pg": "^8.12.0",
    "swagger-ui-express": "^5.0.1",
    "zod": "^3.23.8"
  },
  "devDependencies": {
    "@types/express": "^4.17.21",
    "@types/node": "^20.14.10",
    "@types/pg": "^8.11.6",
    "@types/supertest": "^6.0.2",
    "@types/swagger-ui-express": "^4.1.6",
    "supertest": "^7.0.0",
    "tsx": "^4.16.2",
    "typescript": "^5.5.3",
    "vitest": "^2.0.3"
  }
}
```

- [ ] **Step 2: Create `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "CommonJS",
    "moduleResolution": "node",
    "outDir": "dist",
    "rootDir": ".",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "forceConsistentCasingInFileNames": true
  },
  "include": ["src", "api", "scripts", "tests"]
}
```

- [ ] **Step 3: Create `.gitignore`**

```
node_modules
dist
.env
```

- [ ] **Step 4: Create `.env.example`**

```
DATABASE_URL=postgres://postgres:postgres@localhost:5432/inventory_reservation
PORT=3000
RESERVATION_TTL_MINUTES=10
```

- [ ] **Step 5: Create `vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    testTimeout: 15000,
  },
});
```

- [ ] **Step 6: Install dependencies and verify**

Run: `npm install`
Expected: exits 0, `node_modules/` and `package-lock.json` created.

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json tsconfig.json .gitignore .env.example vitest.config.ts
git commit -m "chore: scaffold npm project, TypeScript, and Vitest config"
```

---

### Task 2: Database Schema Migration & Local Test Postgres

**Goal:** Provide the single SQL migration file (runnable in Supabase's SQL editor with no manual steps) and a local Docker Postgres so later tasks can run real integration tests against it.

**Files:**
- Create: `migrations/0001_init.sql`
- Create: `docker-compose.yml`
- Create: `scripts/migrate.ts`

**Acceptance Criteria:**
- [ ] Migration creates `items`, the `reservation_status` enum, and `reservations`, plus all required indexes and constraints.
- [ ] Migration is idempotent — running it twice does not error (uses `IF NOT EXISTS` / exception-guarded `CREATE TYPE`).
- [ ] `docker compose up -d` brings up a local Postgres reachable at the `DATABASE_URL` in `.env.example`.

**Verify:** `npm run db:up && sleep 3 && npm run db:migrate && npm run db:migrate` → both migration runs exit 0 (second run proves idempotency).

**Steps:**

- [ ] **Step 1: Create `migrations/0001_init.sql`**

```sql
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS items (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name            text NOT NULL,
  total_quantity  integer NOT NULL CHECK (total_quantity > 0),
  created_at      timestamptz NOT NULL DEFAULT now()
);

DO $$ BEGIN
  CREATE TYPE reservation_status AS ENUM ('PENDING', 'CONFIRMED', 'CANCELLED', 'EXPIRED');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS reservations (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id       uuid NOT NULL REFERENCES items(id),
  customer_id   text NOT NULL,
  quantity      integer NOT NULL CHECK (quantity > 0),
  status        reservation_status NOT NULL DEFAULT 'PENDING',
  created_at    timestamptz NOT NULL DEFAULT now(),
  expires_at    timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_reservations_item_id ON reservations(item_id);
CREATE INDEX IF NOT EXISTS idx_reservations_status ON reservations(status);
CREATE INDEX IF NOT EXISTS idx_reservations_expires_at ON reservations(expires_at);
CREATE INDEX IF NOT EXISTS idx_reservations_item_active ON reservations(item_id, status, expires_at);
```

- [ ] **Step 2: Create `docker-compose.yml`**

```yaml
services:
  postgres:
    image: postgres:16
    environment:
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: postgres
      POSTGRES_DB: inventory_reservation
    ports:
      - "5432:5432"
```

- [ ] **Step 3: Create `scripts/migrate.ts`**

```ts
import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Client } from 'pg';

async function main() {
  const sql = readFileSync(join(__dirname, '../migrations/0001_init.sql'), 'utf-8');
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    await client.query(sql);
    console.log('Migration applied successfully.');
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 4: Bring up Postgres and run the migration twice**

Run: `npm run db:up`
Expected: container starts (`docker compose ps` shows `postgres` as running/healthy within a few seconds).

Run: `npm run db:migrate`
Expected: prints `Migration applied successfully.`, exits 0.

Run: `npm run db:migrate` again
Expected: also prints `Migration applied successfully.`, exits 0 — proves the migration is safe to re-run.

- [ ] **Step 5: Commit**

```bash
git add migrations/0001_init.sql docker-compose.yml scripts/migrate.ts
git commit -m "feat: add SQL migration and local Docker Postgres for testing"
```

---

### Task 3: DB Connection Pool, Transaction Helper, and Data-Access Functions

**Goal:** Provide the thin `pg`-based data-access layer that every service will call — connection pool, a transaction helper for the row-locked reservation-creation path, and typed query functions for `items` and `reservations`.

**Files:**
- Create: `src/db/pool.ts`
- Create: `src/db/types.ts`
- Create: `src/db/withTransaction.ts`
- Create: `src/db/items.ts`
- Create: `src/db/reservations.ts`
- Create: `tests/integration/testDb.ts`
- Test: `tests/integration/db.test.ts`

**Acceptance Criteria:**
- [ ] `getItemAggregates` counts only unexpired `PENDING` reservations as `held` and only `CONFIRMED` reservations as `confirmed` — expired and cancelled reservations count toward neither.
- [ ] `confirmPendingReservation` / `cancelPendingReservation` only affect rows currently in `PENDING` status and return `null` (not an error) when no row matches.
- [ ] `expireStaleReservations` only expires `PENDING` rows whose `expires_at` has passed.
- [ ] `lockItemById` acquires a row lock usable inside a transaction (`SELECT ... FOR UPDATE`).

**Verify:** `npm run db:up && npm run db:migrate && npm run test:integration -- tests/integration/db.test.ts` → all tests pass.

**Steps:**

- [ ] **Step 1: Create `src/db/types.ts`**

```ts
import { Pool, PoolClient } from 'pg';

export type Queryable = Pool | PoolClient;

export type ReservationStatus = 'PENDING' | 'CONFIRMED' | 'CANCELLED' | 'EXPIRED';

export interface ItemRow {
  id: string;
  name: string;
  total_quantity: number;
  created_at: string;
}

export interface ReservationRow {
  id: string;
  item_id: string;
  customer_id: string;
  quantity: number;
  status: ReservationStatus;
  created_at: string;
  expires_at: string;
}
```

- [ ] **Step 2: Create `src/db/pool.ts`**

```ts
import { Pool } from 'pg';

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});
```

- [ ] **Step 3: Create `src/db/withTransaction.ts`**

```ts
import { PoolClient } from 'pg';
import { pool } from './pool';

export async function withTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
```

- [ ] **Step 4: Create `src/db/items.ts`**

```ts
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
```

- [ ] **Step 5: Create `src/db/reservations.ts`**

```ts
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
```

- [ ] **Step 6: Create `tests/integration/testDb.ts`**

```ts
import { pool } from '../../src/db/pool';

export async function resetDb(): Promise<void> {
  await pool.query('TRUNCATE reservations, items RESTART IDENTITY CASCADE');
}

export async function closeDb(): Promise<void> {
  await pool.end();
}
```

- [ ] **Step 7: Write the failing test `tests/integration/db.test.ts`**

```ts
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
```

- [ ] **Step 8: Run the test**

Run: `npm run db:up && npm run db:migrate && npm run test:integration -- tests/integration/db.test.ts`
Expected: PASS (all cases green) — since the implementation was written alongside the test, this proves the SQL is correct, not that TDD red was observed. If any case fails, fix the SQL/function in question before proceeding.

- [ ] **Step 9: Commit**

```bash
git add src/db tests/integration/testDb.ts tests/integration/db.test.ts
git commit -m "feat: add pg pool, transaction helper, and items/reservations data access"
```

---

### Task 4: Errors, Validation Schemas, and Middleware

**Goal:** Provide the cross-cutting request-handling pieces every route will use: typed error classes, a consistent error-response middleware, request-body validation middleware, and the zod schemas for the two request bodies in the spec.

**Files:**
- Create: `src/errors/index.ts`
- Create: `src/middleware/validate.ts`
- Create: `src/middleware/errorHandler.ts`
- Create: `src/validation/items.ts`
- Create: `src/validation/reservations.ts`
- Test: `tests/unit/errorHandler.test.ts`
- Test: `tests/unit/validate.test.ts`
- Test: `tests/unit/validation.schemas.test.ts`

**Acceptance Criteria:**
- [ ] `errorHandler` maps `ValidationError` → 400, `NotFoundError` → 404, `ConflictError` → 409, anything else → 500, always as `{ error: { code, message } }`.
- [ ] `validateBody` calls `next(new ValidationError(...))` on a failing schema and otherwise replaces `req.body` with the parsed value.
- [ ] `createItemSchema` rejects `initial_quantity <= 0`; `createReservationSchema` rejects a non-UUID `item_id` and `quantity <= 0`.

**Verify:** `npm run test:unit` → all pass.

**Steps:**

- [ ] **Step 1: Create `src/errors/index.ts`**

```ts
export class AppError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class ValidationError extends AppError {
  constructor(message: string) {
    super('VALIDATION_ERROR', message);
  }
}

export class NotFoundError extends AppError {
  constructor(message: string) {
    super('NOT_FOUND', message);
  }
}

export class ConflictError extends AppError {
  constructor(code: string, message: string) {
    super(code, message);
  }
}
```

- [ ] **Step 2: Create `src/middleware/errorHandler.ts`**

```ts
import { ErrorRequestHandler } from 'express';
import { AppError, ValidationError, NotFoundError, ConflictError } from '../errors';

function statusFor(err: AppError): number {
  if (err instanceof ValidationError) return 400;
  if (err instanceof NotFoundError) return 404;
  if (err instanceof ConflictError) return 409;
  return 500;
}

export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof AppError) {
    res.status(statusFor(err)).json({ error: { code: err.code, message: err.message } });
    return;
  }
  console.error(err);
  res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Unexpected error' } });
};
```

- [ ] **Step 3: Create `src/middleware/validate.ts`**

```ts
import { RequestHandler } from 'express';
import { ZodSchema } from 'zod';
import { ValidationError } from '../errors';

export const validateBody = (schema: ZodSchema): RequestHandler => (req, _res, next) => {
  const result = schema.safeParse(req.body);
  if (!result.success) {
    next(new ValidationError(result.error.issues.map((i) => i.message).join('; ')));
    return;
  }
  req.body = result.data;
  next();
};
```

- [ ] **Step 4: Create `src/validation/items.ts`**

```ts
import { z } from 'zod';

export const createItemSchema = z.object({
  name: z.string().min(1),
  initial_quantity: z.number().int().positive(),
});

export type CreateItemInput = z.infer<typeof createItemSchema>;
```

- [ ] **Step 5: Create `src/validation/reservations.ts`**

```ts
import { z } from 'zod';

export const createReservationSchema = z.object({
  item_id: z.string().uuid(),
  customer_id: z.string().min(1),
  quantity: z.number().int().positive(),
});

export type CreateReservationInput = z.infer<typeof createReservationSchema>;
```

- [ ] **Step 6: Write `tests/unit/errorHandler.test.ts`**

```ts
import { describe, it, expect, vi } from 'vitest';
import { errorHandler } from '../../src/middleware/errorHandler';
import { NotFoundError, ConflictError, ValidationError } from '../../src/errors';

function mockRes() {
  const res: any = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res;
}

describe('errorHandler', () => {
  it('maps NotFoundError to 404', () => {
    const res = mockRes();
    errorHandler(new NotFoundError('missing'), {} as any, res, vi.fn());
    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({ error: { code: 'NOT_FOUND', message: 'missing' } });
  });

  it('maps ConflictError to 409', () => {
    const res = mockRes();
    errorHandler(new ConflictError('INSUFFICIENT_AVAILABILITY', 'no stock'), {} as any, res, vi.fn());
    expect(res.status).toHaveBeenCalledWith(409);
  });

  it('maps ValidationError to 400', () => {
    const res = mockRes();
    errorHandler(new ValidationError('bad input'), {} as any, res, vi.fn());
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('maps unknown errors to 500', () => {
    const res = mockRes();
    errorHandler(new Error('boom'), {} as any, res, vi.fn());
    expect(res.status).toHaveBeenCalledWith(500);
  });
});
```

- [ ] **Step 7: Write `tests/unit/validate.test.ts`**

```ts
import { describe, it, expect, vi } from 'vitest';
import { z } from 'zod';
import { validateBody } from '../../src/middleware/validate';
import { ValidationError } from '../../src/errors';

describe('validateBody', () => {
  const schema = z.object({ name: z.string().min(1) });

  it('calls next with no error when body is valid', () => {
    const req: any = { body: { name: 'Widget' } };
    const next = vi.fn();
    validateBody(schema)(req, {} as any, next);
    expect(next).toHaveBeenCalledWith();
    expect(req.body).toEqual({ name: 'Widget' });
  });

  it('calls next with a ValidationError when body is invalid', () => {
    const req: any = { body: {} };
    const next = vi.fn();
    validateBody(schema)(req, {} as any, next);
    expect(next).toHaveBeenCalledWith(expect.any(ValidationError));
  });
});
```

- [ ] **Step 8: Write `tests/unit/validation.schemas.test.ts`**

```ts
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
```

- [ ] **Step 9: Run the tests**

Run: `npm run test:unit`
Expected: PASS

- [ ] **Step 10: Commit**

```bash
git add src/errors src/middleware src/validation tests/unit
git commit -m "feat: add typed errors, validation middleware, and request schemas"
```

---

### Task 5: Items Service, Routes, and the Express App

**Goal:** Implement item creation and status lookup, and create `src/app.ts` — the Express app that all future tasks will extend by mounting more routers.

**Files:**
- Create: `src/services/items.ts`
- Create: `src/routes/items.ts`
- Create: `src/app.ts`
- Test: `tests/integration/items.test.ts`

**Acceptance Criteria:**
- [ ] `POST /v1/items` returns 201 with `id`, `name`, `total_quantity`.
- [ ] `POST /v1/items` returns 400 for `initial_quantity <= 0`.
- [ ] `GET /v1/items/:id` returns `total_quantity`, `available_quantity`, `held_quantity`, `confirmed_quantity`.
- [ ] `GET /v1/items/:id` returns 404 for an unknown id.

**Verify:** `npm run db:up && npm run db:migrate && npm run test:integration -- tests/integration/items.test.ts` → all pass.

**Steps:**

- [ ] **Step 1: Create `src/services/items.ts`**

```ts
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
```

- [ ] **Step 2: Create `src/routes/items.ts`**

```ts
import { Router } from 'express';
import { validateBody } from '../middleware/validate';
import { createItemSchema } from '../validation/items';
import { createItem, getItemStatus } from '../services/items';

export const itemsRouter = Router();

itemsRouter.post('/', validateBody(createItemSchema), async (req, res, next) => {
  try {
    const { name, initial_quantity } = req.body;
    const item = await createItem({ name, totalQuantity: initial_quantity });
    res.status(201).json(item);
  } catch (err) {
    next(err);
  }
});

itemsRouter.get('/:id', async (req, res, next) => {
  try {
    const status = await getItemStatus(req.params.id);
    res.json(status);
  } catch (err) {
    next(err);
  }
});
```

- [ ] **Step 3: Create `src/app.ts`**

```ts
import express from 'express';
import { itemsRouter } from './routes/items';
import { errorHandler } from './middleware/errorHandler';

export function createApp() {
  const app = express();
  app.use(express.json());

  app.use('/v1/items', itemsRouter);

  app.use(errorHandler);
  return app;
}
```

- [ ] **Step 4: Write `tests/integration/items.test.ts`**

```ts
import { describe, it, expect, afterEach, afterAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app';
import { resetDb, closeDb } from './testDb';

const app = createApp();

afterEach(resetDb);
afterAll(closeDb);

describe('POST /v1/items', () => {
  it('creates an item and returns its id, name, and total quantity', async () => {
    const res = await request(app).post('/v1/items').send({ name: 'White T-Shirt', initial_quantity: 5 });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ name: 'White T-Shirt', total_quantity: 5 });
    expect(res.body.id).toBeTypeOf('string');
  });

  it('rejects a non-positive initial_quantity', async () => {
    const res = await request(app).post('/v1/items').send({ name: 'X', initial_quantity: 0 });
    expect(res.status).toBe(400);
  });
});

describe('GET /v1/items/:id', () => {
  it('returns total, available, held, and confirmed quantities', async () => {
    const created = await request(app).post('/v1/items').send({ name: 'Mug', initial_quantity: 10 });
    const res = await request(app).get(`/v1/items/${created.body.id}`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      total_quantity: 10,
      available_quantity: 10,
      held_quantity: 0,
      confirmed_quantity: 0,
    });
  });

  it('returns 404 for an unknown item', async () => {
    const res = await request(app).get('/v1/items/11111111-1111-1111-1111-111111111111');
    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 5: Run the tests**

Run: `npm run db:up && npm run db:migrate && npm run test:integration -- tests/integration/items.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/services/items.ts src/routes/items.ts src/app.ts tests/integration/items.test.ts
git commit -m "feat: add item creation and status endpoints"
```

---

### Task 6: Reservation Creation (Concurrency-Safe)

**Goal:** Implement `POST /v1/reservations` using the row-lock + derived-availability transaction described in the spec, and prove it never oversells under concurrent load.

**Files:**
- Create: `src/services/reservations.ts`
- Create: `src/routes/reservations.ts`
- Modify: `src/app.ts` — mount `reservationsRouter`
- Test: `tests/integration/reservations.test.ts`
- Test: `tests/integration/concurrency.test.ts`

**Acceptance Criteria:**
- [ ] A reservation is created as `PENDING` with an `expires_at` `RESERVATION_TTL_MINUTES` minutes in the future.
- [ ] Requesting more than the currently available quantity returns 409 with `code: "INSUFFICIENT_AVAILABILITY"`.
- [ ] 10 concurrent 1-unit reservation requests against an item with quantity 5 result in exactly 5 successes and 5 `409`s, and the item's `available_quantity` afterward is exactly 0.

**Verify:** `npm run db:up && npm run db:migrate && npm run test:integration -- tests/integration/reservations.test.ts tests/integration/concurrency.test.ts` → all pass.

**Steps:**

- [ ] **Step 1: Create `src/services/reservations.ts`**

```ts
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
```

Note: `pool` is imported here so later steps in this task (confirm/cancel, added in Task 7) can share the module — it is unused by `createReservation` itself, which always runs inside `withTransaction`. Leave the import in place; Task 7 will use it.

- [ ] **Step 2: Create `src/routes/reservations.ts`**

```ts
import { Router } from 'express';
import { validateBody } from '../middleware/validate';
import { createReservationSchema } from '../validation/reservations';
import { createReservation } from '../services/reservations';

export const reservationsRouter = Router();

reservationsRouter.post('/', validateBody(createReservationSchema), async (req, res, next) => {
  try {
    const { item_id, customer_id, quantity } = req.body;
    const reservation = await createReservation({ itemId: item_id, customerId: customer_id, quantity });
    res.status(201).json(reservation);
  } catch (err) {
    next(err);
  }
});
```

- [ ] **Step 3: Modify `src/app.ts` to mount the reservations router**

```ts
import express from 'express';
import { itemsRouter } from './routes/items';
import { reservationsRouter } from './routes/reservations';
import { errorHandler } from './middleware/errorHandler';

export function createApp() {
  const app = express();
  app.use(express.json());

  app.use('/v1/items', itemsRouter);
  app.use('/v1/reservations', reservationsRouter);

  app.use(errorHandler);
  return app;
}
```

- [ ] **Step 4: Write `tests/integration/reservations.test.ts`**

```ts
import { describe, it, expect, afterEach, afterAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app';
import { resetDb, closeDb } from './testDb';

const app = createApp();

afterEach(resetDb);
afterAll(closeDb);

async function createItem(quantity: number) {
  const res = await request(app).post('/v1/items').send({ name: 'Item', initial_quantity: quantity });
  return res.body.id as string;
}

describe('POST /v1/reservations', () => {
  it('creates a PENDING reservation with an expiry in the future', async () => {
    const itemId = await createItem(5);
    const res = await request(app)
      .post('/v1/reservations')
      .send({ item_id: itemId, customer_id: 'c1', quantity: 2 });

    expect(res.status).toBe(201);
    expect(res.body.status).toBe('PENDING');
    expect(new Date(res.body.expires_at).getTime()).toBeGreaterThan(Date.now());
  });

  it('rejects a reservation when insufficient quantity is available', async () => {
    const itemId = await createItem(2);
    const res = await request(app)
      .post('/v1/reservations')
      .send({ item_id: itemId, customer_id: 'c1', quantity: 3 });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('INSUFFICIENT_AVAILABILITY');
  });

  it('returns 404 when the item does not exist', async () => {
    const res = await request(app)
      .post('/v1/reservations')
      .send({ item_id: '11111111-1111-1111-1111-111111111111', customer_id: 'c1', quantity: 1 });

    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 5: Write `tests/integration/concurrency.test.ts`**

```ts
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
```

- [ ] **Step 6: Run the tests**

Run: `npm run db:up && npm run db:migrate && npm run test:integration -- tests/integration/reservations.test.ts tests/integration/concurrency.test.ts`
Expected: PASS, including the concurrency test showing exactly 5 succeeded / 5 rejected.

- [ ] **Step 7: Commit**

```bash
git add src/services/reservations.ts src/routes/reservations.ts src/app.ts tests/integration/reservations.test.ts tests/integration/concurrency.test.ts
git commit -m "feat: add concurrency-safe reservation creation"
```

---

### Task 7: Confirm & Cancel Reservations (Retry-Safe)

**Goal:** Implement `POST /v1/reservations/:id/confirm` and `POST /v1/reservations/:id/cancel`, both idempotent under retries and correct around expiration.

**Files:**
- Modify: `src/services/reservations.ts` — add `confirmReservation`, `cancelReservation`
- Modify: `src/routes/reservations.ts` — add the two sub-routes
- Modify: `tests/integration/reservations.test.ts` — extend with lifecycle/retry-safety cases

**Acceptance Criteria:**
- [ ] Confirming a `PENDING` reservation sets status `CONFIRMED`; the item's `confirmed_quantity` increases and `available_quantity` stays reduced.
- [ ] Confirming an already-`CONFIRMED` reservation again returns 200 with the same state (idempotent), not an error.
- [ ] Confirming an expired `PENDING` reservation returns 409 with `code: "RESERVATION_EXPIRED"` and does not change `available_quantity`.
- [ ] Cancelling a `PENDING` reservation releases its quantity back to `available_quantity`.
- [ ] Cancelling an already-`CANCELLED` reservation again returns 200 (idempotent), not an error.
- [ ] Cancelling a `CONFIRMED` reservation returns 409 and does not change `available_quantity`.

**Verify:** `npm run db:up && npm run db:migrate && npm run test:integration -- tests/integration/reservations.test.ts` → all pass.

**Steps:**

- [ ] **Step 1: Add `confirmReservation` and `cancelReservation` to `src/services/reservations.ts`**

Append to the existing file (which already has the `pool`, `withTransaction`, `lockItemById`, `getItemAggregates`, `insertReservation`, `NotFoundError`, `ConflictError` imports from Task 6):

```ts
import { confirmPendingReservation, cancelPendingReservation, findReservationById } from '../db/reservations';

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
```

Both functions try the atomic conditional `UPDATE` first; only if it matches zero rows do they read current state to decide whether this is a safe no-op retry (already in the target terminal status) or a genuine conflict. This ordering avoids a race where two concurrent requests both read `PENDING` before either writes.

- [ ] **Step 2: Add the two sub-routes to `src/routes/reservations.ts`**

Append to the existing router:

```ts
import { confirmReservation, cancelReservation } from '../services/reservations';

reservationsRouter.post('/:id/confirm', async (req, res, next) => {
  try {
    const reservation = await confirmReservation(req.params.id);
    res.json(reservation);
  } catch (err) {
    next(err);
  }
});

reservationsRouter.post('/:id/cancel', async (req, res, next) => {
  try {
    const reservation = await cancelReservation(req.params.id);
    res.json(reservation);
  } catch (err) {
    next(err);
  }
});
```

(Merge the two `import` lines from `../services/reservations` at the top of the file into one: `import { createReservation, confirmReservation, cancelReservation } from '../services/reservations';`.)

- [ ] **Step 3: Extend `tests/integration/reservations.test.ts`**

Append these `describe` blocks to the existing file (which already imports `app`, `resetDb`, `closeDb`, `createItem`):

```ts
import { pool } from '../../src/db/pool';

describe('reservation lifecycle', () => {
  it('reserves, then confirms, permanently reducing availability', async () => {
    const itemId = await createItem(5);
    const reserveRes = await request(app)
      .post('/v1/reservations')
      .send({ item_id: itemId, customer_id: 'c1', quantity: 2 });

    const confirmRes = await request(app).post(`/v1/reservations/${reserveRes.body.id}/confirm`);
    expect(confirmRes.status).toBe(200);
    expect(confirmRes.body.status).toBe('CONFIRMED');

    const status = await request(app).get(`/v1/items/${itemId}`);
    expect(status.body).toMatchObject({ available_quantity: 3, held_quantity: 0, confirmed_quantity: 2 });
  });

  it('cancelling releases the held quantity back to availability', async () => {
    const itemId = await createItem(5);
    const reserveRes = await request(app)
      .post('/v1/reservations')
      .send({ item_id: itemId, customer_id: 'c1', quantity: 2 });
    await request(app).post(`/v1/reservations/${reserveRes.body.id}/cancel`);

    const status = await request(app).get(`/v1/items/${itemId}`);
    expect(status.body).toMatchObject({ available_quantity: 5, held_quantity: 0 });
  });

  it('confirming twice is idempotent and does not double-deduct', async () => {
    const itemId = await createItem(5);
    const reserveRes = await request(app)
      .post('/v1/reservations')
      .send({ item_id: itemId, customer_id: 'c1', quantity: 2 });

    const first = await request(app).post(`/v1/reservations/${reserveRes.body.id}/confirm`);
    const second = await request(app).post(`/v1/reservations/${reserveRes.body.id}/confirm`);
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(second.body.status).toBe('CONFIRMED');

    const status = await request(app).get(`/v1/items/${itemId}`);
    expect(status.body.confirmed_quantity).toBe(2);
  });

  it('cancelling twice is idempotent and does not double-release', async () => {
    const itemId = await createItem(5);
    const reserveRes = await request(app)
      .post('/v1/reservations')
      .send({ item_id: itemId, customer_id: 'c1', quantity: 2 });

    const first = await request(app).post(`/v1/reservations/${reserveRes.body.id}/cancel`);
    const second = await request(app).post(`/v1/reservations/${reserveRes.body.id}/cancel`);
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);

    const status = await request(app).get(`/v1/items/${itemId}`);
    expect(status.body.available_quantity).toBe(5);
  });

  it('cancelling after confirmation does not increase availability', async () => {
    const itemId = await createItem(5);
    const reserveRes = await request(app)
      .post('/v1/reservations')
      .send({ item_id: itemId, customer_id: 'c1', quantity: 2 });
    await request(app).post(`/v1/reservations/${reserveRes.body.id}/confirm`);

    const cancelRes = await request(app).post(`/v1/reservations/${reserveRes.body.id}/cancel`);
    expect(cancelRes.status).toBe(409);

    const status = await request(app).get(`/v1/items/${itemId}`);
    expect(status.body).toMatchObject({ available_quantity: 3, confirmed_quantity: 2 });
  });

  it('confirming after expiration does not deduct inventory', async () => {
    const itemId = await createItem(5);
    const reserveRes = await request(app)
      .post('/v1/reservations')
      .send({ item_id: itemId, customer_id: 'c1', quantity: 2 });

    await pool.query(`UPDATE reservations SET expires_at = now() - interval '1 minute' WHERE id = $1`, [
      reserveRes.body.id,
    ]);

    const confirmRes = await request(app).post(`/v1/reservations/${reserveRes.body.id}/confirm`);
    expect(confirmRes.status).toBe(409);
    expect(confirmRes.body.error.code).toBe('RESERVATION_EXPIRED');

    const status = await request(app).get(`/v1/items/${itemId}`);
    expect(status.body.available_quantity).toBe(5);
    expect(status.body.held_quantity).toBe(0);
  });
});
```

- [ ] **Step 4: Run the tests**

Run: `npm run db:up && npm run db:migrate && npm run test:integration -- tests/integration/reservations.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/services/reservations.ts src/routes/reservations.ts tests/integration/reservations.test.ts
git commit -m "feat: add retry-safe confirm and cancel reservation endpoints"
```

---

### Task 8: Expire-Reservations Maintenance Endpoint

**Goal:** Implement `POST /v1/maintenance/expire-reservations`, which bulk-expires stale `PENDING` reservations and releases their quantity.

**Files:**
- Modify: `src/services/reservations.ts` — add `expireReservations`
- Create: `src/routes/maintenance.ts`
- Modify: `src/app.ts` — mount `maintenanceRouter`
- Test: `tests/integration/maintenance.test.ts`

**Acceptance Criteria:**
- [ ] Running the endpoint marks all `PENDING` reservations whose `expires_at` has passed as `EXPIRED`.
- [ ] Reservations that are not yet expired, or already in a terminal status, are untouched.
- [ ] The item's `available_quantity` reflects the release immediately after the call.

**Verify:** `npm run db:up && npm run db:migrate && npm run test:integration -- tests/integration/maintenance.test.ts` → all pass.

**Steps:**

- [ ] **Step 1: Add `expireReservations` to `src/services/reservations.ts`**

```ts
import { expireStaleReservations } from '../db/reservations';

export async function expireReservations() {
  const expired = await expireStaleReservations(pool);
  return { expired_count: expired.length, expired_ids: expired.map((r) => r.id) };
}
```

(Add `expireStaleReservations` to the existing `import { confirmPendingReservation, cancelPendingReservation, findReservationById } from '../db/reservations';` line from Task 7.)

- [ ] **Step 2: Create `src/routes/maintenance.ts`**

```ts
import { Router } from 'express';
import { expireReservations } from '../services/reservations';

export const maintenanceRouter = Router();

maintenanceRouter.post('/expire-reservations', async (_req, res, next) => {
  try {
    const result = await expireReservations();
    res.json(result);
  } catch (err) {
    next(err);
  }
});
```

- [ ] **Step 3: Modify `src/app.ts` to mount the maintenance router**

```ts
import express from 'express';
import { itemsRouter } from './routes/items';
import { reservationsRouter } from './routes/reservations';
import { maintenanceRouter } from './routes/maintenance';
import { errorHandler } from './middleware/errorHandler';

export function createApp() {
  const app = express();
  app.use(express.json());

  app.use('/v1/items', itemsRouter);
  app.use('/v1/reservations', reservationsRouter);
  app.use('/v1/maintenance', maintenanceRouter);

  app.use(errorHandler);
  return app;
}
```

- [ ] **Step 4: Write `tests/integration/maintenance.test.ts`**

```ts
import { describe, it, expect, afterEach, afterAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app';
import { pool } from '../../src/db/pool';
import { resetDb, closeDb } from './testDb';

const app = createApp();

afterEach(resetDb);
afterAll(closeDb);

describe('POST /v1/maintenance/expire-reservations', () => {
  it('marks expired pending reservations as EXPIRED and frees their quantity', async () => {
    const created = await request(app).post('/v1/items').send({ name: 'Item', initial_quantity: 5 });
    const itemId = created.body.id as string;
    const reserveRes = await request(app)
      .post('/v1/reservations')
      .send({ item_id: itemId, customer_id: 'c1', quantity: 2 });

    await pool.query(`UPDATE reservations SET expires_at = now() - interval '1 minute' WHERE id = $1`, [
      reserveRes.body.id,
    ]);

    const expireRes = await request(app).post('/v1/maintenance/expire-reservations');
    expect(expireRes.status).toBe(200);
    expect(expireRes.body.expired_ids).toContain(reserveRes.body.id);

    const status = await request(app).get(`/v1/items/${itemId}`);
    expect(status.body.available_quantity).toBe(5);
  });

  it('leaves non-expired pending reservations untouched', async () => {
    const created = await request(app).post('/v1/items').send({ name: 'Item', initial_quantity: 5 });
    const itemId = created.body.id as string;
    const reserveRes = await request(app)
      .post('/v1/reservations')
      .send({ item_id: itemId, customer_id: 'c1', quantity: 2 });

    const expireRes = await request(app).post('/v1/maintenance/expire-reservations');
    expect(expireRes.body.expired_ids).not.toContain(reserveRes.body.id);

    const status = await request(app).get(`/v1/items/${itemId}`);
    expect(status.body.held_quantity).toBe(2);
  });
});
```

- [ ] **Step 5: Run the tests**

Run: `npm run db:up && npm run db:migrate && npm run test:integration -- tests/integration/maintenance.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/services/reservations.ts src/routes/maintenance.ts src/app.ts tests/integration/maintenance.test.ts
git commit -m "feat: add expire-reservations maintenance endpoint"
```

---

### Task 9: OpenAPI Spec & Swagger UI

**Goal:** Serve a hand-authored OpenAPI document at `/openapi.json` and render it via Swagger UI at `/docs`, matching the real endpoint behavior.

**Files:**
- Create: `src/openapi/openapi.json`
- Modify: `src/app.ts` — serve `/openapi.json` and mount Swagger UI at `/docs`
- Test: `tests/integration/docs.test.ts`

**Acceptance Criteria:**
- [ ] `GET /openapi.json` returns 200 with a valid OpenAPI 3.0 document.
- [ ] `GET /docs` returns 200 (Swagger UI HTML).
- [ ] The document's `paths` cover all six required endpoints.

**Verify:** `npm run db:up && npm run db:migrate && npm run test:integration -- tests/integration/docs.test.ts` → all pass.

**Steps:**

- [ ] **Step 1: Create `src/openapi/openapi.json`**

```json
{
  "openapi": "3.0.3",
  "info": {
    "title": "Inventory Reservation API",
    "version": "1.0.0",
    "description": "Create items, place temporary reservations against their stock, confirm or cancel those reservations, and expire stale ones — all without overselling under concurrent load."
  },
  "paths": {
    "/v1/items": {
      "post": {
        "summary": "Create an item",
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": { "$ref": "#/components/schemas/CreateItemRequest" }
            }
          }
        },
        "responses": {
          "201": {
            "description": "Item created",
            "content": { "application/json": { "schema": { "$ref": "#/components/schemas/Item" } } }
          },
          "400": { "description": "Validation error", "content": { "application/json": { "schema": { "$ref": "#/components/schemas/Error" } } } }
        }
      }
    },
    "/v1/items/{id}": {
      "get": {
        "summary": "Get item status",
        "parameters": [{ "name": "id", "in": "path", "required": true, "schema": { "type": "string", "format": "uuid" } }],
        "responses": {
          "200": {
            "description": "Item status",
            "content": { "application/json": { "schema": { "$ref": "#/components/schemas/ItemStatus" } } }
          },
          "404": { "description": "Item not found", "content": { "application/json": { "schema": { "$ref": "#/components/schemas/Error" } } } }
        }
      }
    },
    "/v1/reservations": {
      "post": {
        "summary": "Create a reservation (temporary hold)",
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": { "$ref": "#/components/schemas/CreateReservationRequest" }
            }
          }
        },
        "responses": {
          "201": {
            "description": "Reservation created",
            "content": { "application/json": { "schema": { "$ref": "#/components/schemas/Reservation" } } }
          },
          "409": { "description": "Insufficient availability", "content": { "application/json": { "schema": { "$ref": "#/components/schemas/Error" } } } }
        }
      }
    },
    "/v1/reservations/{id}/confirm": {
      "post": {
        "summary": "Confirm a reservation",
        "parameters": [{ "name": "id", "in": "path", "required": true, "schema": { "type": "string", "format": "uuid" } }],
        "responses": {
          "200": {
            "description": "Reservation confirmed",
            "content": { "application/json": { "schema": { "$ref": "#/components/schemas/Reservation" } } }
          },
          "409": { "description": "Reservation cannot be confirmed", "content": { "application/json": { "schema": { "$ref": "#/components/schemas/Error" } } } }
        }
      }
    },
    "/v1/reservations/{id}/cancel": {
      "post": {
        "summary": "Cancel a reservation",
        "parameters": [{ "name": "id", "in": "path", "required": true, "schema": { "type": "string", "format": "uuid" } }],
        "responses": {
          "200": {
            "description": "Reservation cancelled",
            "content": { "application/json": { "schema": { "$ref": "#/components/schemas/Reservation" } } }
          },
          "409": { "description": "Reservation cannot be cancelled", "content": { "application/json": { "schema": { "$ref": "#/components/schemas/Error" } } } }
        }
      }
    },
    "/v1/maintenance/expire-reservations": {
      "post": {
        "summary": "Expire stale pending reservations",
        "responses": {
          "200": {
            "description": "Expiration result",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "expired_count": { "type": "integer" },
                    "expired_ids": { "type": "array", "items": { "type": "string", "format": "uuid" } }
                  }
                }
              }
            }
          }
        }
      }
    }
  },
  "components": {
    "schemas": {
      "CreateItemRequest": {
        "type": "object",
        "required": ["name", "initial_quantity"],
        "properties": {
          "name": { "type": "string" },
          "initial_quantity": { "type": "integer", "minimum": 1 }
        }
      },
      "Item": {
        "type": "object",
        "properties": {
          "id": { "type": "string", "format": "uuid" },
          "name": { "type": "string" },
          "total_quantity": { "type": "integer" },
          "created_at": { "type": "string", "format": "date-time" }
        }
      },
      "ItemStatus": {
        "type": "object",
        "properties": {
          "id": { "type": "string", "format": "uuid" },
          "name": { "type": "string" },
          "total_quantity": { "type": "integer" },
          "available_quantity": { "type": "integer" },
          "held_quantity": { "type": "integer" },
          "confirmed_quantity": { "type": "integer" }
        }
      },
      "CreateReservationRequest": {
        "type": "object",
        "required": ["item_id", "customer_id", "quantity"],
        "properties": {
          "item_id": { "type": "string", "format": "uuid" },
          "customer_id": { "type": "string" },
          "quantity": { "type": "integer", "minimum": 1 }
        }
      },
      "Reservation": {
        "type": "object",
        "properties": {
          "id": { "type": "string", "format": "uuid" },
          "item_id": { "type": "string", "format": "uuid" },
          "customer_id": { "type": "string" },
          "quantity": { "type": "integer" },
          "status": { "type": "string", "enum": ["PENDING", "CONFIRMED", "CANCELLED", "EXPIRED"] },
          "created_at": { "type": "string", "format": "date-time" },
          "expires_at": { "type": "string", "format": "date-time" }
        }
      },
      "Error": {
        "type": "object",
        "properties": {
          "error": {
            "type": "object",
            "properties": {
              "code": { "type": "string" },
              "message": { "type": "string" }
            }
          }
        }
      }
    }
  }
}
```

- [ ] **Step 2: Modify `src/app.ts` to serve the docs**

```ts
import express from 'express';
import swaggerUi from 'swagger-ui-express';
import openapiDocument from './openapi/openapi.json';
import { itemsRouter } from './routes/items';
import { reservationsRouter } from './routes/reservations';
import { maintenanceRouter } from './routes/maintenance';
import { errorHandler } from './middleware/errorHandler';

export function createApp() {
  const app = express();
  app.use(express.json());

  app.get('/openapi.json', (_req, res) => res.json(openapiDocument));
  app.use('/docs', swaggerUi.serve, swaggerUi.setup(openapiDocument));

  app.use('/v1/items', itemsRouter);
  app.use('/v1/reservations', reservationsRouter);
  app.use('/v1/maintenance', maintenanceRouter);

  app.use(errorHandler);
  return app;
}
```

- [ ] **Step 3: Write `tests/integration/docs.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app';

const app = createApp();

describe('API documentation', () => {
  it('serves the OpenAPI document as JSON', async () => {
    const res = await request(app).get('/openapi.json');
    expect(res.status).toBe(200);
    expect(res.body.openapi).toBe('3.0.3');

    const requiredPaths = [
      '/v1/items',
      '/v1/items/{id}',
      '/v1/reservations',
      '/v1/reservations/{id}/confirm',
      '/v1/reservations/{id}/cancel',
      '/v1/maintenance/expire-reservations',
    ];
    for (const path of requiredPaths) {
      expect(res.body.paths).toHaveProperty(path);
    }
  });

  it('serves Swagger UI', async () => {
    const res = await request(app).get('/docs/');
    expect(res.status).toBe(200);
    expect(res.text).toContain('swagger-ui');
  });
});
```

- [ ] **Step 4: Run the tests**

Run: `npm run test:integration -- tests/integration/docs.test.ts`
Expected: PASS (this test needs no database, but leaving the db up from earlier tasks is harmless)

- [ ] **Step 5: Commit**

```bash
git add src/openapi src/app.ts tests/integration/docs.test.ts
git commit -m "feat: serve OpenAPI document and Swagger UI"
```

---

### Task 10: Local Dev Server Entry Point

**Goal:** Add the local `app.listen` entry point so the API can be run and manually exercised (and recorded for the demo video).

**Files:**
- Create: `src/server.ts`

**Acceptance Criteria:**
- [ ] `npm run build` compiles the whole project with no TypeScript errors.
- [ ] `npm run dev` starts the server and logs a listening message.
- [ ] `GET /docs` on the running server returns 200.

**Verify:** `npm run build` → exits 0. `npm run dev` (in a separate terminal, with Postgres up and migrated) → logs `Inventory Reservation API listening on port 3000`; `curl -i http://localhost:3000/docs/` → `HTTP/1.1 200`.

**Steps:**

- [ ] **Step 1: Create `src/server.ts`**

```ts
import 'dotenv/config';
import { createApp } from './app';

const port = Number(process.env.PORT ?? 3000);

createApp().listen(port, () => {
  console.log(`Inventory Reservation API listening on port ${port}`);
});
```

- [ ] **Step 2: Verify the build compiles**

Run: `npm run build`
Expected: exits 0, `dist/` populated, no TypeScript errors.

- [ ] **Step 3: Manually verify the server runs**

Run (with `npm run db:up` and `npm run db:migrate` already done, and a `.env` copied from `.env.example`): `npm run dev`
Expected: console prints `Inventory Reservation API listening on port 3000`.

In a second terminal, run: `curl -i http://localhost:3000/docs/`
Expected: `HTTP/1.1 200 OK` with HTML body containing `swagger-ui`.

Stop the dev server (Ctrl+C) before continuing.

- [ ] **Step 4: Commit**

```bash
git add src/server.ts
git commit -m "feat: add local dev server entry point"
```

---

### Task 11: Vercel Deployment Artifacts

**Goal:** Prepare the serverless entry point and Vercel routing config so the user can deploy with `vercel` themselves (per the user's decision, this task does not run an actual deploy).

**Files:**
- Create: `api/index.ts`
- Create: `vercel.json`
- Test: `tests/unit/api-entry.test.ts`

**Acceptance Criteria:**
- [ ] `api/index.ts` exports the same Express app used by `src/server.ts` (no duplicated route wiring).
- [ ] `vercel.json` routes all paths to `api/index.ts`.

**Verify:** `npm run test:unit` → all pass, including the new API-entry test. `npx tsc --noEmit` → exits 0.

**Steps:**

- [ ] **Step 1: Create `api/index.ts`**

```ts
import { createApp } from '../src/app';

export default createApp();
```

- [ ] **Step 2: Create `vercel.json`**

```json
{
  "version": 2,
  "builds": [{ "src": "api/index.ts", "use": "@vercel/node" }],
  "routes": [{ "src": "/(.*)", "dest": "api/index.ts" }]
}
```

- [ ] **Step 3: Write `tests/unit/api-entry.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import app from '../../api/index';

describe('Vercel entry point', () => {
  it('exports the Express app as a callable request handler', () => {
    expect(typeof app).toBe('function');
  });
});
```

- [ ] **Step 4: Run the tests**

Run: `npm run test:unit`
Expected: PASS

Run: `npx tsc --noEmit`
Expected: exits 0, no type errors across `src`, `api`, `scripts`, `tests`.

- [ ] **Step 5: Commit**

```bash
git add api vercel.json tests/unit/api-entry.test.ts
git commit -m "feat: add Vercel serverless entry point and routing config"
```

---

### Task 12: Concurrency Demo Script

**Goal:** Provide a standalone script that fires concurrent reservation requests against a *running* server and prints the outcome — used in the demo video and referenced by the README's concurrency-reproduction steps.

**Files:**
- Create: `scripts/concurrency-demo.ts`

**Acceptance Criteria:**
- [ ] Script creates a fresh item, fires 10 concurrent 1-unit reservation requests, and prints how many succeeded vs. were rejected, plus the item's final status.
- [ ] Script reads the target server URL from `API_BASE_URL`, defaulting to `http://localhost:3000`.

**Verify:** With the dev server running (`npm run dev`, Postgres up and migrated), run `npm run demo:concurrency` in a second terminal → prints `Succeeded: 5, Rejected (409 insufficient availability): 5` and a final item status with `available_quantity: 0`.

**Steps:**

- [ ] **Step 1: Create `scripts/concurrency-demo.ts`**

```ts
const BASE_URL = process.env.API_BASE_URL ?? 'http://localhost:3000';
const CONCURRENT_REQUESTS = 10;
const ITEM_QUANTITY = 5;

async function main() {
  const createRes = await fetch(`${BASE_URL}/v1/items`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Concurrency Demo Item', initial_quantity: ITEM_QUANTITY }),
  });
  const item = await createRes.json();
  console.log(`Created item ${item.id} with quantity ${ITEM_QUANTITY}`);

  const attempts = Array.from({ length: CONCURRENT_REQUESTS }, (_, i) =>
    fetch(`${BASE_URL}/v1/reservations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ item_id: item.id, customer_id: `customer-${i}`, quantity: 1 }),
    }).then(async (res) => ({ status: res.status, body: await res.json() }))
  );

  const results = await Promise.all(attempts);
  const succeeded = results.filter((r) => r.status === 201).length;
  const rejected = results.filter((r) => r.status === 409).length;

  console.log(`Fired ${CONCURRENT_REQUESTS} concurrent reservation requests for 1 unit each.`);
  console.log(`Succeeded: ${succeeded}, Rejected (409 insufficient availability): ${rejected}`);

  const statusRes = await fetch(`${BASE_URL}/v1/items/${item.id}`);
  console.log('Final item status:', await statusRes.json());
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 2: Manually verify against the running dev server**

Run (terminal 1, if not already running): `npm run dev`
Run (terminal 2): `npm run demo:concurrency`
Expected output includes: `Succeeded: 5, Rejected (409 insufficient availability): 5` and a final item status object with `"available_quantity": 0`.

- [ ] **Step 3: Commit**

```bash
git add scripts/concurrency-demo.ts
git commit -m "feat: add standalone concurrency demo script"
```

---

### Task 13: README

**Goal:** Write the README covering every documentation requirement from the assignment: overview, Supabase setup, local run, env vars, Vercel deploy steps, concurrency reproduction, demo video link, and known limitations.

**Files:**
- Create: `README.md`

**Acceptance Criteria:**
- [ ] Covers: overview/assumptions, Supabase setup + migration, local run, env vars (matching `.env.example`), Vercel deploy steps, a placeholder line for the deployed URL, concurrency reproduction steps, a placeholder line for the demo video link, and known limitations.
- [ ] Every command in the README has already been run successfully in an earlier task (no untested instructions).

**Verify:** Manually re-read the README top to bottom and confirm every command matches a command already verified in Tasks 1–12.

**Steps:**

- [ ] **Step 1: Create `README.md`**

```markdown
# Inventory Reservation API

- **GitHub repo:** (this repository)
- **Deployed URL:** TODO — fill in after running `vercel --prod` (see "Deploy to Vercel" below)
- **Demo video:** TODO — add the video link here

## Overview

A small backend API for a fictitious store: create items with stock, place
temporary reservations ("holds") against that stock, confirm or cancel a
reservation, and expire stale holds. The system is designed so that
concurrent requests can never oversell an item's stock, and that retrying
a confirm or cancel call is always safe.

**Key assumption:** availability is never stored as a mutable counter.
Instead, `available = total_quantity - held - confirmed` is computed on
every read directly from the `reservations` table, where `held` only
counts `PENDING` reservations that haven't expired yet. This means
cancelling or expiring a reservation is just a status change — there is
nothing to keep in sync, and no way for a counter to drift from reality.
See `docs/design/specs/2026-09-17-inventory-reservation-api-design.md`
for the full design rationale.

## Tech stack

Express.js + TypeScript, Supabase (PostgreSQL) via raw `pg` (no ORM), zod
for validation, swagger-ui-express for API docs, Vitest + supertest for
testing, Vercel for deployment.

## Project structure

```
src/
  routes/       Express routers
  services/     Business logic (no SQL, no HTTP)
  db/           Data access (raw SQL via pg)
  validation/   zod request schemas
  errors/       Typed error classes
  middleware/   Validation + error-handling middleware
  openapi/      Hand-authored OpenAPI document
api/            Vercel serverless entry point
migrations/     SQL migration file(s)
scripts/        One-off scripts (migration runner, concurrency demo)
tests/          Unit and integration tests
```

## Setting up Supabase and running the migration

1. Create a new project at [supabase.com](https://supabase.com).
2. Open the SQL Editor in your Supabase project dashboard.
3. Paste the entire contents of `migrations/0001_init.sql` and run it. It
   is idempotent — safe to run more than once — and requires no other
   manual setup.
4. From your project's Settings → Database page, copy the **connection
   string** (use the pooled/"Transaction" connection string, port 6543,
   for anything that will run on Vercel — see "Deploy to Vercel" below).

## Environment variables

Copy `.env.example` to `.env` and fill in the values:

| Variable | Description |
|---|---|
| `DATABASE_URL` | Postgres connection string (Supabase, or local Docker Postgres for development) |
| `PORT` | Port the local server listens on (default `3000`) |
| `RESERVATION_TTL_MINUTES` | How long a new reservation stays valid before it can be expired (default `10`) |

## Running locally

**Option A — against a local Docker Postgres (no Supabase account needed):**

```bash
npm install
npm run db:up          # starts a local Postgres in Docker
npm run db:migrate      # applies migrations/0001_init.sql
cp .env.example .env    # DATABASE_URL already points at the local Docker Postgres
npm run dev
```

**Option B — against your Supabase project:**

```bash
npm install
cp .env.example .env    # set DATABASE_URL to your Supabase connection string
npm run dev
```

Once running, visit `http://localhost:3000/docs` for interactive Swagger
UI, or fetch the raw spec from `http://localhost:3000/openapi.json`.

## Running tests

```bash
npm run test:unit           # fast, no database required
npm run db:up && npm run db:migrate
npm run test:integration    # full endpoint lifecycle + the concurrency test, against real Postgres
```

## Reproducing the concurrency scenario

The automated test at `tests/integration/concurrency.test.ts` already
proves this on every `npm run test:integration` run: it creates an item
with quantity 5, fires 10 concurrent reservation requests for 1 unit
each, and asserts exactly 5 succeed and 5 receive `409
INSUFFICIENT_AVAILABILITY`.

To see it live against a running server (this is what the demo video
shows):

```bash
npm run dev                 # terminal 1
npm run demo:concurrency    # terminal 2
```

This creates a new item with quantity 5 and fires 10 concurrent
`POST /v1/reservations` requests for 1 unit each, then prints how many
succeeded/were rejected and the item's final status
(`available_quantity: 0`).

## Deploying to Vercel

```bash
npm install -g vercel   # if you don't already have the CLI
vercel login
vercel                  # first deploy; follow the prompts to link/create a project
vercel env add DATABASE_URL production   # paste your Supabase POOLED connection string (port 6543)
vercel env add RESERVATION_TTL_MINUTES production
vercel --prod
```

**Important:** use Supabase's **pooled** connection string (pgbouncer,
port 6543), not the direct connection — Vercel's serverless functions
can't hold a long-lived connection pool the way a normal Node server can.

After deploying, update the "Deployed URL" line at the top of this
README with the URL Vercel prints.

## Known limitations / trade-offs

- No authentication — matches the assignment's explicit exclusion of a
  user registration system. `customer_id` is an opaque, unvalidated
  string.
- No rate limiting — listed as optional in the assignment.
- Expiration is only applied when `POST /v1/maintenance/expire-reservations`
  is called (no background worker/cron), per the assignment's explicit
  exclusion of background queues/workers. In production you'd point a
  scheduler (e.g. Vercel Cron) at this endpoint periodically; this repo
  does not configure one.
- `total_quantity` is fixed at item creation — restocking an existing
  item is not supported, since it wasn't part of the required behavior.
```

- [ ] **Step 2: Manually verify the README**

Re-read `README.md` top to bottom. Confirm every shell command listed matches a command already verified in an earlier task, and every environment variable matches `.env.example`.

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: add README with setup, deployment, and concurrency reproduction steps"
```
