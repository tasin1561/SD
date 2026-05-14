# @skydrop/api

NestJS REST API for Skydrop — `api.skydrop.online`.

---

## Quick start (local dev)

Prerequisites: Docker, Node 22, pnpm 11.

```bash
# 1. From the repo root, start Postgres + Redis.
pnpm db:up

# 2. Build @skydrop/db (compiles + emits types).
pnpm --filter @skydrop/db build

# 3. Apply migrations + seed reference data.
pnpm --filter @skydrop/db migrate:deploy
pnpm --filter @skydrop/db seed

# 4. Copy the env template and edit if needed.
cp apps/api/.env.example apps/api/.env

# 5. Install workspace deps (if you haven't yet).
pnpm install

# 6. Run the API in watch mode.
pnpm --filter @skydrop/api start:dev
```

The API is listening on **http://localhost:4000**.

- `GET /health` — aggregate DB + Redis check
- `GET /health/live` — process liveness (always 200 when running)
- `GET /health/ready` — readiness with detailed checks
- `GET /api/docs` — Swagger UI (dev only)

### Create a staff user for smoke testing

There's no staff registration endpoint in Module 1 — staff are created
out-of-band. The helper script idempotently upserts a staff row with an
argon2-hashed password:

```bash
pnpm --filter @skydrop/db exec tsx \
  ../../apps/api/scripts/create-staff-user.ts \
  admin@skydrop.online 'YourPassword!1234' SUPER_ADMIN
```

Allowed roles: `SUPER_ADMIN`, `SELLER_APPROVAL_ADMIN`, `CALL_AGENT`,
`WAREHOUSE_STAFF`, `MANUAL_PLACEMENT_ADMIN`, `FINANCE`.

---

## Scripts

| Script        | What it does                                         |
|---------------|------------------------------------------------------|
| `start:dev`   | Nest in watch mode (auto-rebuild + reboot)           |
| `start:debug` | Nest in watch mode with `--inspect`                  |
| `build`       | Compile to `dist/` (calls `nest build`)              |
| `start`       | Run already-built `dist/main.js`                     |
| `start:prod`  | Same as `start`, for production manifests            |
| `typecheck`   | `tsc --noEmit` over `src/`, `test/`, `scripts/`      |
| `lint`        | ESLint v9 flat config, fails on any warning          |
| `test`        | Jest unit tests (no DB; in-memory fakes only)        |
| `test:e2e`    | Jest end-to-end tests against a dedicated `skydrop_test` Postgres database |
| `clean`       | Removes `dist/`, `.turbo/`, `coverage/`              |

### Running tests

```bash
# Unit tests — fast, no DB.
pnpm --filter @skydrop/api test

# End-to-end tests — spin up the real Nest app against a separate
# Postgres DB (skydrop_test). globalSetup creates the DB, runs
# migrations, and seeds; globalTeardown drops it.
pnpm --filter @skydrop/api test:e2e
```

E2E tests use a dedicated Redis logical DB (default: `redis://localhost:6379/1`)
so they don't interfere with the dev API's rate-limit counters or BullMQ queues.

---

## Configuration

Every env var is validated by `src/config/env.schema.ts` (zod). The app
refuses to boot if any required value is missing or malformed.

| Variable           | Required | Default                                   | Notes |
|--------------------|----------|-------------------------------------------|-------|
| `NODE_ENV`         | no       | `development`                             | `development` \| `production` \| `test` |
| `PORT`             | no       | `4000`                                    | |
| `LOG_LEVEL`        | no       | `info`                                    | pino levels |
| `DATABASE_URL`     | **yes**  | —                                         | Postgres URL with `?schema=public` |
| `REDIS_URL`        | **yes**  | —                                         | ioredis URL |
| `JWT_SIGNING_KEY`  | **yes**  | —                                         | min 32 chars; `openssl rand -base64 64` |
| `SELLER_APP_URL`   | **yes**  | —                                         | used in email links + CORS |
| `ADMIN_APP_URL`    | **yes**  | —                                         | used in email links + CORS |
| `RESEND_API_KEY`   | no       | (empty)                                   | empty → dev-mode log emails to stdout |
| `COOKIE_DOMAIN`    | no       | (unset)                                   | leave unset for `__Host-` cookies |

---

## Layout

```
src/
├── main.ts                       # bootstrap: helmet, CORS, cookies, pino, swagger
├── app.module.ts                 # composes feature + infra modules
├── config/                       # zod-validated env
├── common/
│   ├── decorators/               # @Public, @CurrentStaff, @CurrentSeller, @ClientInfo
│   ├── cookies/                  # __Host-staffRefresh / __Host-sellerRefresh helpers
│   ├── filters/                  # AllExceptionsFilter → { code, message, requestId }
│   ├── guards/                   # StaffJwtGuard, SellerJwtGuard, ApiKeyGuard
│   ├── middleware/               # request-id
│   ├── pino/                     # logger config (redaction)
│   ├── throttler/                # AppThrottlerGuard, @ThrottleKey, module
│   └── types/                    # express Request augmentation
├── infrastructure/
│   ├── prisma/                   # singleton client + health check
│   └── redis/                    # ioredis service + duplicate() helper
└── modules/
    ├── health/
    ├── auth-common/              # password, jwt, token-hash, refresh-token, audit-log
    ├── email/                    # resend, template-render, dispatch, queue + worker
    ├── staff-auth/               # /auth/staff/*
    ├── seller-auth/              # /auth/seller/*
    ├── seller-invitation/        # /admin/seller-invitations
    └── seller-api-key/           # /seller/api-keys + ApiKeyGuard

test/
├── unit/                         # jest specs against in-memory fakes
└── e2e/                          # jest specs against real Postgres + Redis
    ├── global-setup.ts           # creates skydrop_test, migrates, seeds
    ├── global-teardown.ts        # drops skydrop_test
    ├── app-harness.ts            # bootTestApp, resetAuthState, createTestStaff
    └── *.e2e-spec.ts
```

---

## Module 1 (Auth) — endpoint map

```
POST /auth/staff/login                          (rate: 5/15min @ email+ip)
POST /auth/staff/refresh
POST /auth/staff/logout
POST /auth/staff/logout-all                     (auth)
POST /auth/staff/password-reset/request         (rate: 3/h @ email)
POST /auth/staff/password-reset/confirm
POST /auth/staff/email-verification/request     (auth, rate: 3/h @ user)
POST /auth/staff/email-verification/confirm
GET  /auth/staff/me                             (auth)

POST /auth/seller/register/invite               (rate: 10/h @ ip)
POST /auth/seller/login                         (rate: 5/15min @ email+ip)
POST /auth/seller/refresh
POST /auth/seller/logout
POST /auth/seller/logout-all                    (auth)
POST /auth/seller/password-reset/request        (rate: 3/h @ email)
POST /auth/seller/password-reset/confirm
POST /auth/seller/email-verification/request    (auth, rate: 3/h @ user)
POST /auth/seller/email-verification/confirm
GET  /auth/seller/me                            (auth)

POST   /admin/seller-invitations                (staff auth)
GET    /admin/seller-invitations                (staff auth)
POST   /admin/seller-invitations/:id/resend     (staff auth)
DELETE /admin/seller-invitations/:id            (staff auth)

POST /seller/api-keys                           (seller auth)
GET  /seller/api-keys                           (seller auth)
POST /seller/api-keys/:id/revoke                (seller auth)
```

See `docs/phase-1a-debt.md` for tracked deferrals.
