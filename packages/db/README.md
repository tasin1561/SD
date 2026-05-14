# @skydrop/db

Prisma schema, generated client, migrations, and seed for the Skydrop database.

The canonical schema spec lives at [`docs/db-schema.md`](../../docs/db-schema.md). If
the Prisma schema and the spec disagree, the spec wins — update Prisma to match.

## What's in here

- `prisma/schema.prisma` — the schema (60 models across 9 layers, all enums).
- `prisma/migrations/` — generated SQL migrations. The initial migration appends
  TimescaleDB hypertable setup for `tracking_events` and `stock_movements`.
- `prisma/seed.ts` — idempotent reference seed (system settings, default
  couriers, fallback FX, BLR warehouse, default rate card, 12 notification
  templates).
- `src/client.ts` — singleton `PrismaClient` with environment-aware logging.
- `src/enums.ts` — re-export of every enum from the generated client.
- `src/index.ts` — barrel export. Consume as `import { ... } from '@skydrop/db'`.

## Setup (local dev)

1. Start Docker Postgres + Redis from the repo root:
   ```
   pnpm db:up
   ```
2. Copy the env file (skip if you already have a repo-root `.env`):
   ```
   cp .env.example .env
   ```
3. Install + generate + migrate + seed:
   ```
   pnpm install
   pnpm --filter @skydrop/db generate
   pnpm --filter @skydrop/db migrate:dev
   pnpm --filter @skydrop/db seed
   ```

## Common commands

```
pnpm --filter @skydrop/db studio          # Prisma Studio
pnpm --filter @skydrop/db migrate:dev     # create + apply new migration
pnpm --filter @skydrop/db migrate:status  # show pending migrations
pnpm --filter @skydrop/db migrate:reset   # WIPE local DB, replay all migrations, run seed
pnpm --filter @skydrop/db db:push         # iterate on schema before formal migration
pnpm --filter @skydrop/db format          # `prisma format`
pnpm --filter @skydrop/db validate        # `prisma validate`
```

## Conventions

- All UUID PKs use Postgres 18's native `uuidv7()` — sortable + time-ordered.
- All timestamps are `timestamptz` (UTC).
- `tracking_events` and `stock_movements` are TimescaleDB hypertables with
  composite PK `(id, created_at)` and 1-month chunks.
- See [`docs/db-schema.md`](../../docs/db-schema.md) for the full convention
  list, indexes per table, enum values, and seed contents.
