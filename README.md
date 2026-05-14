# Skydrop

Cross-border courier aggregator platform.

- **Sellers:** Bangladesh-based e-commerce merchants
- **Customers:** Indian shoppers (recipients)
- **Stock:** held in Skydrop's warehouse(s) in India
- **Couriers:** Delhivery primary + other Indian couriers as fallback

## Architecture

Monorepo (Turborepo) containing:

- `apps/marketing` — Public marketing site (`skydrop.online`)
- `apps/seller` — Seller portal (`app.skydrop.online`)
- `apps/admin` — Admin & staff portal (`admin.skydrop.online`)
- `apps/track` — Public branded tracking page (`track.skydrop.online`)
- `apps/api` — NestJS backend API (`api.skydrop.online`)
- `apps/workers` — BullMQ background job workers
- `packages/*` — Shared types, UI, config, database client, etc.

## Stack

- **Frontend:** Next.js 15 (App Router) + TypeScript + Tailwind CSS + shadcn/ui
- **Backend:** NestJS + TypeScript + Prisma
- **Database:** PostgreSQL 18 (DigitalOcean Managed) + PostGIS + TimescaleDB
- **Cache / Queue:** Redis + BullMQ
- **Storage:** DigitalOcean Spaces (S3-compatible)
- **Auth:** Custom (Passport.js + JWT + refresh tokens, RBAC)
- **Hosting:** DigitalOcean (Droplet + Managed Postgres + Spaces) + Cloudflare

## Development

See [`CLAUDE.md`](./CLAUDE.md) for conventions and the master spec.

```bash
pnpm install
pnpm dev
```

## Status

Phase 1A — pre-launch development.

## License

Proprietary. All rights reserved.
