# Inventory Reservation API — Design Spec

Date: 2026-09-17
Status: Approved (pending user's final review of this document)

## 1. Purpose

Take-home assignment submission: a backend API for a fictitious store that
lets customers place temporary holds ("reservations") on item stock,
confirm or cancel those holds, and expire stale holds — without ever
overselling inventory, even under concurrent requests.

This document is the source of truth for the implementation plan that
follows it. It does not cover the future Next.js frontend, which is out of
scope for this build.

## 2. Non-goals

Per the assignment's explicit exclusions, this system does not include:
authentication/user registration, payment integration, background
queues/workers, or an admin UI. Rate limiting is not implemented (spec
marks it optional).

## 3. Tech stack

- Express.js + TypeScript
- Supabase (PostgreSQL) as the database
- Raw `pg` (node-postgres) for data access — no ORM/query builder
- zod for request validation
- swagger-ui-express serving a hand-authored `openapi.json`
- Vitest + supertest for testing
- Docker Compose for a local test Postgres instance
- Vercel for deployment (serverless function wrapping the Express app)
- npm as package manager

## 4. Project structure

```
src/
  routes/         Express routers — parse request, call a service, shape the response
  services/       Business logic (reservation rules, expiry rules). No SQL, no HTTP.
  db/             Thin data-access functions (raw SQL via pg), connection pool, tx helper
  validation/     zod schemas per endpoint
  errors/         Typed error classes + one Express error-handling middleware
  openapi/        Static openapi.json
  app.ts          Express app construction (used by both local dev and the Vercel entry point)
  server.ts       Local dev entry point (app.listen)
api/
  index.ts        Vercel serverless entry point, imports app.ts
migrations/
  0001_init.sql   Full schema: tables, constraints, indexes, foreign keys
scripts/
  concurrency-demo.ts   Fires concurrent reservation requests against a live server, prints results
docker-compose.yml      Local Postgres for integration tests
tests/
  unit/           Service-layer logic, mocked db client
  integration/    Full lifecycle against a real (dockerized) Postgres, includes the concurrency test
```

Dependency direction is strictly one-way: `routes` → `services` → `db`.
Services are plain functions that accept a db client/transaction as an
argument, which is what makes them testable without an HTTP server or a
real network connection.

## 5. Data model

```sql
CREATE TABLE items (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name            text NOT NULL,
  total_quantity  integer NOT NULL CHECK (total_quantity > 0),
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TYPE reservation_status AS ENUM ('PENDING', 'CONFIRMED', 'CANCELLED', 'EXPIRED');

CREATE TABLE reservations (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id       uuid NOT NULL REFERENCES items(id),
  customer_id   text NOT NULL,
  quantity      integer NOT NULL CHECK (quantity > 0),
  status        reservation_status NOT NULL DEFAULT 'PENDING',
  created_at    timestamptz NOT NULL DEFAULT now(),
  expires_at    timestamptz NOT NULL
);

CREATE INDEX idx_reservations_item_id ON reservations(item_id);
CREATE INDEX idx_reservations_status ON reservations(status);
CREATE INDEX idx_reservations_expires_at ON reservations(expires_at);
CREATE INDEX idx_reservations_item_active ON reservations(item_id, status, expires_at);
```

`total_quantity` is immutable after creation — restocking is out of scope.
`reservation_status` is a Postgres `ENUM` so invalid statuses are rejected
by the database itself, not just application code.

## 6. Availability model (the core design decision)

`items` does **not** store a mutable "available quantity" counter.
Availability is always derived at read time:

```
available = total_quantity − held − confirmed

held      = SUM(quantity) FROM reservations
            WHERE item_id = ? AND status = 'PENDING' AND expires_at > now()
confirmed = SUM(quantity) FROM reservations
            WHERE item_id = ? AND status = 'CONFIRMED'
```

Rationale: a stored counter must be kept in sync by every operation that
touches it (reserve, confirm, cancel, expire) — four places for drift to
creep in. Deriving availability from `reservations` gives a single source
of truth: cancelling or expiring a reservation requires no numeric update
at all, just a `status` change, and the derived availability
automatically recovers because that row drops out of the `held` sum.

### Per-operation concurrency safety

- **Create reservation** — one transaction: `SELECT ... FOR UPDATE` on the
  item row (serializes concurrent attempts against the *same* item only),
  aggregate current `held + confirmed`, compare against the requested
  quantity, `INSERT` the reservation if it fits, else roll back and
  respond `409`.
- **Confirm** — single statement, no item lock:
  `UPDATE reservations SET status = 'CONFIRMED' WHERE id = $1 AND status = 'PENDING' AND expires_at > now() RETURNING *`.
  Zero rows affected means the reservation was already confirmed,
  cancelled, or expired — respond accordingly. Retrying a confirm is a
  no-op the second time because the `WHERE status = 'PENDING'` guard
  fails.
- **Cancel** — same pattern:
  `UPDATE reservations SET status = 'CANCELLED' WHERE id = $1 AND status = 'PENDING' RETURNING *`.
  A second cancel call matches zero rows and stays idempotent.
- **Expire (maintenance endpoint)** — bulk update:
  `UPDATE reservations SET status = 'EXPIRED' WHERE status = 'PENDING' AND expires_at <= now()`.

No advisory locks, no application-level mutexes, no background workers —
row locking plus conditional `UPDATE ... WHERE` guards are sufficient and
keep the logic auditable in plain SQL.

## 7. API surface

All endpoints from the assignment (`POST /v1/items`, `GET /v1/items/:id`,
`POST /v1/reservations`, `POST /v1/reservations/:id/confirm`,
`POST /v1/reservations/:id/cancel`, `POST /v1/maintenance/expire-reservations`)
are implemented exactly as specified in the assignment document. No
additional endpoints are added (YAGNI).

- **Validation**: zod schema per endpoint, applied by a small middleware
  that parses `req.body`/`req.params` and throws a typed `ValidationError`
  on failure.
- **Error shape**, consistent across all failures:
  ```json
  { "error": { "code": "INSUFFICIENT_AVAILABILITY", "message": "Only 2 units available" } }
  ```
  A single Express error-handling middleware maps typed error classes to
  HTTP status + this shape (`ValidationError` → 400, `NotFoundError` → 404,
  `ConflictError` → 409). Route and service code only ever `throw`s.
- **Reservation TTL**: defaults to 10 minutes, configurable via
  `RESERVATION_TTL_MINUTES`.
- **OpenAPI docs**: hand-authored `src/openapi/openapi.json`, served as JSON
  at `/openapi.json` and rendered via `swagger-ui-express` at `/docs`. Not
  generated from code comments, so it stays decoupled from implementation
  detail and easy to eyeball against real behavior before submission.
- No auth, no rate limiting.

## 8. Testing strategy

- **Unit tests**: expiry-window calculation, error-mapping, input
  validation edge cases (zero/negative quantity, missing fields) — against
  services with a mocked db client.
- **Integration tests**: full lifecycle per endpoint against a real
  Postgres (Docker Compose, migration applied automatically before the
  suite runs), including the retry-safety rules (confirm twice, cancel
  twice, confirm-after-expiry).
- **Concurrency test**: create an item with quantity 5, fire 10 concurrent
  `POST /v1/reservations` requests (1 unit each, distinct customers),
  assert exactly 5 succeed and 5 receive `409`, then assert the item's
  derived availability is exactly 0. This is both an automated test and
  the basis for `scripts/concurrency-demo.ts`, a standalone script used
  in the demo video and referenced in the README's reproduction steps.
- Runner: Vitest. HTTP-level integration tests via supertest.

## 9. Deployment

- `api/index.ts` wraps the same Express app used locally (`src/app.ts`)
  for Vercel's Node serverless runtime; `vercel.json` routes all paths to
  it.
- Production `DATABASE_URL` must be Supabase's **pooled** connection
  string (pgbouncer, port 6543) — serverless functions can't hold a
  long-lived connection pool. Called out explicitly in the README.
- The maintenance endpoint stays a plain HTTP endpoint, triggered manually
  or by an external scheduler (e.g. Vercel Cron) — no background worker,
  per the assignment's exclusions.

## 10. Documentation

README.md covers: overview and assumptions, Supabase setup + running the
migration, running locally, required env vars (mirrored in `.env.example`),
Vercel deployment steps, the deployed URL, how to reproduce the
concurrency scenario, a link to the demo video, and known
limitations/trade-offs.

## 11. Scope note on the assignment's "4-hour timebox"

Per the user's decision, this submission is built to be genuinely solid
rather than simulating a literal 4-hour cutoff — including automated
tests and Docker-based local testing infra, which a time-boxed solo
effort might have skipped. The README will state this honestly rather
than presenting it as a raw 4-hour effort.
