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
See `docs/superpowers/specs/2026-09-17-inventory-reservation-api-design.md`
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
4. From your project's Settings → Database page, copy the **pooled
   ("Transaction pooler") connection string**, not the direct connection.
   It looks like:
   ```
   postgresql://postgres.<project-ref>:<password>@aws-0-<region>.pooler.supabase.com:6543/postgres
   ```
   Use this for `DATABASE_URL` everywhere — locally and on Vercel — not
   just in production. Supabase's **direct** connection host
   (`db.<project-ref>.supabase.co`) only has an IPv6 address; on a
   network/machine without IPv6 egress it fails with
   `getaddrinfo ENOTFOUND`. The pooled host resolves over plain IPv4 and
   works everywhere, which is also why it's required for Vercel's
   serverless functions (see "Deploy to Vercel" below).

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

## Manual testing with Bruno

A ready-to-use [Bruno](https://www.usebruno.com/) collection is included at
`bruno/`. Open that folder directly in the Bruno app, select the `local`
environment, and run requests in order:

1. **Items → Create Item** — creates an item and auto-saves its id as the
   `itemId` variable for every other request.
2. **Items → Get Item Status** — check availability at any point.
3. **Reservations → Create/Confirm/Cancel Reservation** — chained via an
   auto-saved `reservationId` variable.
4. **Maintenance → Expire Reservations**.
5. **Concurrency Demo** folder — 10 pre-built "reserve 1 unit" requests
   against the same item, for a quick visual demo of stock depleting and
   409s appearing. Note: clicking through these is NOT a rigorous
   concurrency proof (Bruno sends one request at a time) — see the next
   section for that.

A `production` environment is also included with a placeholder `baseUrl`
to swap in once deployed.

## Running tests

```bash
npm run test:unit           # fast, no database required
npm run db:up && npm run db:migrate
npm run test:integration    # full endpoint lifecycle + the concurrency test, against real Postgres
```

**Warning:** the integration suite `TRUNCATE`s the `items`/`reservations`
tables between test cases. `DATABASE_URL` is shared by `npm run dev` and
`npm run test:integration` — if you point it at your real Supabase project
(e.g. while manually testing via Swagger/Bruno), do **not** run
`npm run test:integration` until you switch `DATABASE_URL` back to the
local Docker Postgres (`postgres://postgres:postgres@localhost:5432/inventory_reservation`),
or you'll wipe your Supabase data.

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
- `npm audit` reports vulnerabilities in `vitest`/`vite`/`esbuild` — these
  are transitive dev-only test-tooling dependencies and are never bundled
  into the deployed API.
