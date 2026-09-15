# Skydrop

Cross-border courier aggregator + light WMS.

A Bangladeshi seller ships stock to our warehouse in India; an Indian customer
orders; our call centre confirms by phone (COD culture makes that essential);
the warehouse picks, packs and dispatches through Delhivery or Shiprocket; we
track it, handle returns, and settle the money. The seller sells into India
without having Indian operations.

## Repo

Turborepo + pnpm workspaces.

| Path | What it is |
|---|---|
| `apps/marketing` | Public site — `skydrop.online` (static export) |
| `apps/seller` | Seller portal — `app.skydrop.online` |
| `apps/admin` | Staff portal — `admin.skydrop.online` |
| `apps/track` | Public tracking page, EN + HI — `track.skydrop.online` |
| `apps/reseller` | Reseller store portal — `reseller.skydrop.online` |
| `apps/api` | NestJS API — `api.skydrop.online` |
| `apps/workers` | Built, **not deployed** — every BullMQ worker runs in-process inside the API |
| `packages/db` | Prisma schema, migrations, generated client (`@skydrop/db`) |
| `packages/ui` | Design tokens, shared components, status→colour mappers |
| `packages/api-client`, `packages/auth` | Typed same-origin client and the identity-parameterised auth layer |
| `packages/config` | Security headers + CSP middleware |
| `packages/types`, `packages/i18n`, `packages/utils` | Placeholders (README only) |

## Stack

Next.js 15 (App Router) · NestJS · Prisma 6.19.3 (pinned) · PostgreSQL 18 +
TimescaleDB · Redis + BullMQ · DigitalOcean Spaces · Passport + JWT (no
third-party auth) · Resend for email · pnpm 11 / Node 22.

Hosted on a DigitalOcean droplet behind Caddy and Cloudflare, with managed
Postgres. PostGIS is deliberately **not** enabled.

## Getting started

```bash
pnpm install
pnpm db:up          # Postgres + Redis in Docker
pnpm dev
```

Copy `.env.example`, `apps/api/.env.example` and `packages/db/.env.example` to
their `.env` counterparts first. Real secrets are never committed.

## Before you commit

```bash
pnpm gate                          # clean + typecheck + lint + format + unit
python3 scripts/check-frontend-routes.py
python3 scripts/check-page-permissions.py
```

`pnpm gate` is the whole gate — run it whole, never a filtered subset, and note
that it deletes `.tsbuildinfo` first because an incremental `tsc` will otherwise
report clean on a file it never checked. The two Python checks catch what no
test can: a frontend call with no route behind it, a route nothing calls, a data
hook no screen uses, and a page whose permission gate does not cover what it
asks the API for.

The API e2e suite and the Playwright projects run in CI only.

## Where the knowledge is

- [`CLAUDE.md`](./CLAUDE.md) — the master spec: scope, the locked stack, and
  every named invariant (ORD-*, INV-*, WMS-*, CUR-*, TRK-*, WAL-*, TRE-*, RS-*)
  with the incident that motivated it. Read it before changing anything.
- [`docs/db-schema.md`](./docs/db-schema.md) — canonical schema. Where it and
  Prisma disagree, the doc wins.
- [`docs/phase-1a-debt.md`](./docs/phase-1a-debt.md) — what is deliberately deferred.
- [`docs/reseller-stores.md`](./docs/reseller-stores.md) — the reseller-store design (RS-1..RS-12).
- [`docs/live-pilot-plan.md`](./docs/live-pilot-plan.md) — the go-live runbook.
- `docs/` also carries the courier wire contracts, infrastructure, CI/CD and DNS.

## Status

Phase 1A is complete, as are the R0–R9 revisions and reseller stores (RS-1..RS-12).
The system is in a **live pilot**: Delhivery and Shiprocket both carry real
parcels, and real money moves. Reseller store orders are built and deployed but
switched off (`reseller.orders_enabled` is seeded false) pending a clean
end-to-end run per seller.

Reason about production posture from the **database**, never from a doc: the
live-write switches are `courier.<code>_live_writes_enabled` and
`courier.<code>_api_base_url`.

## License

Proprietary. All rights reserved.
