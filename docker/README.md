# Local Dev Infrastructure

Docker Compose stack for **local development only** — Postgres (with TimescaleDB) and Redis.
Production runs on DigitalOcean Managed Postgres + Redis on the droplet; do not point this at prod.

## Services

| Service  | Image                                  | Host port (loopback only) | Volume          |
| -------- | -------------------------------------- | ------------------------- | --------------- |
| postgres | `timescale/timescaledb:latest-pg18`    | `127.0.0.1:5432`          | `postgres_data` |
| redis    | `redis:7-alpine`                       | `127.0.0.1:6379`          | none (ephemeral) |

Ports are bound to `127.0.0.1` only — nothing leaks onto your LAN.
Redis runs with persistence disabled (`--save '' --appendonly no`) since it holds only cache + BullMQ state.

## Default connection strings

- **Postgres:** `postgresql://skydrop:skydrop@localhost:5432/skydrop?schema=public`
- **Redis:** `redis://localhost:6379`

Mirror these in your `.env` (copy from `.env.example` at repo root).

## Commands

All commands have `pnpm` wrappers in the root `package.json`:

```bash
pnpm db:up      # start both services in background
pnpm db:down    # stop services, keep data volume
pnpm db:reset   # ⚠️  DESTRUCTIVE: stop services AND delete the Postgres volume, then restart
pnpm db:logs    # tail combined logs (Ctrl-C to exit)
```

Or run `docker compose` directly:

```bash
docker compose -f docker/docker-compose.yml up -d
docker compose -f docker/docker-compose.yml down
docker compose -f docker/docker-compose.yml down -v       # destructive
docker compose -f docker/docker-compose.yml logs -f
docker compose -f docker/docker-compose.yml ps            # status + healthcheck state
```

## Database initialization

`docker/init/01-extensions.sql` runs **only on first boot** against an empty data dir.
It creates the TimescaleDB extension. PostGIS is left commented — enable when zone-based pricing needs it.

To re-run the init SQL after editing it, you must wipe the volume:

```bash
pnpm db:reset
```

## ⚠️  About `db:reset`

`db:reset` runs `docker compose down -v`, which **permanently deletes the `postgres_data` volume**.
All local data (migrations, seed data, manual test rows) is gone. There is no prompt.
Use it intentionally — e.g., to test a fresh migration or re-run the init SQL.

## Healthchecks

Both services declare healthchecks; `docker compose ps` shows `(healthy)` once they pass.

- Postgres: `pg_isready -U skydrop -d skydrop` every 5s
- Redis: `redis-cli ping` every 5s

If `db:up` returns but Postgres takes a moment to become healthy, that's expected on first boot
while the TimescaleDB image runs its init scripts.

## Verifying TimescaleDB is loaded

```bash
docker exec -it skydrop-postgres psql -U skydrop -d skydrop -c "SELECT extname, extversion FROM pg_extension WHERE extname = 'timescaledb';"
```

Should return one row.
