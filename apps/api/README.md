# @skydrop/api

NestJS REST API for Skydrop — `api.skydrop.online`.

## Quick start (local dev)

```bash
# From repo root: make sure Docker Postgres + Redis are up
pnpm db:up

# Copy env template (once)
cp apps/api/.env.example apps/api/.env

# Install + boot (from repo root)
pnpm install
pnpm --filter @skydrop/api start:dev
```

The API will be listening on `http://localhost:4000`.

- `GET /health` — aggregate DB + Redis check
- `GET /health/live` — process liveness
- `GET /health/ready` — readiness with details
- `GET /api/docs` — Swagger UI (dev/test only)

## Scripts

| Script | What it does |
|---|---|
| `start:dev` | Nest in watch mode |
| `build` | Compile to `dist/` |
| `start:prod` | Run compiled output |
| `typecheck` | TS type check (no emit) |
| `lint` | ESLint over `src/` `test/` `scripts/` |
| `test` | Jest unit tests |
| `test:e2e` | Jest end-to-end tests against Docker Postgres |

## Layout

```
src/
├── main.ts                 # bootstrap (helmet, CORS, cookies, pino, swagger)
├── app.module.ts           # composes feature + infra modules
├── config/                 # zod-validated env
├── common/                 # decorators, filters, guards, middleware, types
├── infrastructure/         # prisma + redis adapters
└── modules/                # feature modules (health, auth, …)
```
