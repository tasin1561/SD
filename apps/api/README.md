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
| `SUPPORT_EMAIL`    | no       | `support@skydrop.online`                  | surfaces in transactional email bodies |
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
    ├── seller-api-key/           # /seller/api-keys + ApiKeyGuard
    ├── seller-onboarding/        # progress tracker (no controller; consumed by other modules)
    ├── seller-management/        # SellerAccountStatusService (suspend/reapprove)
    ├── seller-profile/           # /seller/profile, /seller/profile/bank-details
    ├── seller-address/           # /seller/addresses CRUD
    ├── seller-notification-preference/  # /seller/notification-preferences
    ├── admin-seller/             # /admin/sellers — list, detail, status, notes, onboarding
    ├── catalog-category/         # /admin/categories tree + /seller/categories reads
    ├── catalog-attribute/        # category attribute defs + effective-set resolver (Redis)
    ├── catalog-category-proposal/ # seller propose / admin approve|reject
    ├── catalog-product/          # /seller/products CRUD + archive
    ├── catalog-variant/          # /seller/products/:id/variants + attribute validation
    ├── catalog-image/            # presign/register + thumbnail & orphan-sweep crons
    ├── catalog-csv-import/       # CSV template/preview/process + saved mappings
    └── catalog-read/             # CatalogReadService — sole cross-module variant read

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

## Module 2 (Seller Onboarding) — endpoint map

```
GET    /seller/profile                          (seller auth, allow-suspended)
PATCH  /seller/profile                          (seller auth, APPROVED)
PATCH  /seller/profile/bank-details             (seller auth, APPROVED)

GET    /seller/addresses                        (seller auth, allow-suspended)
POST   /seller/addresses                        (seller auth, APPROVED)
PATCH  /seller/addresses/:id                    (seller auth, APPROVED)
DELETE /seller/addresses/:id                    (seller auth, APPROVED)
POST   /seller/addresses/:id/set-default        (seller auth, APPROVED)

GET    /seller/notification-preferences         (seller auth, allow-suspended)
PATCH  /seller/notification-preferences/:cat    (seller auth, APPROVED)

GET    /admin/sellers                           (staff auth)
GET    /admin/sellers/:id                       (staff auth)
PATCH  /admin/sellers/:id/status                (staff auth)
GET    /admin/sellers/:id/notes                 (staff auth)
POST   /admin/sellers/:id/notes                 (staff auth)
PATCH  /admin/sellers/:id/notes/:noteId         (staff auth)
DELETE /admin/sellers/:id/notes/:noteId         (staff auth)
GET    /admin/sellers/:id/onboarding            (staff auth)
POST   /admin/sellers/:id/onboarding/:step/override  (staff auth)
```

Notes:
- Endpoints tagged "allow-suspended" use the `@SellerAuthAllowSuspended()`
  decorator so SUSPENDED sellers retain read-only access. APPROVED is
  always sufficient; PENDING/REJECTED never pass either guard.
- Auth changes from Module 2: login + refresh now accept SUSPENDED in
  addition to APPROVED (status check). The write-side guard default
  remains APPROVED-only.

## Module 4 (Product/SKU Catalog) — endpoint map

```
# Categories — admin manages the tree; sellers read it.
GET    /admin/categories                         (staff auth)
GET    /admin/categories/tree                    (staff auth)
GET    /admin/categories/:id                     (staff auth)
POST   /admin/categories                         (staff auth)
PATCH  /admin/categories/:id                     (staff auth)
POST   /admin/categories/:id/move                (staff auth)
DELETE /admin/categories/:id                     (staff auth)
GET    /seller/categories                        (seller auth, allow-suspended)
GET    /seller/categories/tree                   (seller auth, allow-suspended)
GET    /seller/categories/:id                    (seller auth, allow-suspended)

# Category attribute definitions (own set + inherited "effective" set).
GET    /admin/categories/:categoryId/attributes            (staff auth)
GET    /admin/categories/:categoryId/attributes/effective  (staff auth)
POST   /admin/categories/:categoryId/attributes            (staff auth)
PATCH  /admin/categories/:categoryId/attributes/:id        (staff auth)
DELETE /admin/categories/:categoryId/attributes/:id        (staff auth; soft warning by product count)
GET    /seller/categories/:categoryId/attributes           (seller auth, allow-suspended)

# Category proposals — sellers can't create categories directly.
POST   /seller/category-proposals                (seller auth, APPROVED)
GET    /seller/category-proposals                (seller auth, allow-suspended)
GET    /seller/category-proposals/:id            (seller auth, allow-suspended)
POST   /seller/category-proposals/:id/withdraw   (seller auth, APPROVED)
GET    /admin/category-proposals                 (staff auth)
GET    /admin/category-proposals/:id             (staff auth)
POST   /admin/category-proposals/:id/approve     (staff auth; category+attrs in one tx, email)
POST   /admin/category-proposals/:id/reject      (staff auth; email)

# Products + variants.
POST   /seller/products                          (seller auth, APPROVED)
GET    /seller/products                          (seller auth, allow-suspended)
GET    /seller/products/:id                      (seller auth, allow-suspended)
PATCH  /seller/products/:id                      (seller auth, APPROVED)
POST   /seller/products/:id/archive              (seller auth, APPROVED; cascades to variants)
POST   /seller/products/:id/unarchive            (seller auth, APPROVED)
DELETE /seller/products/:id                      (seller auth, APPROVED; soft, cascades)
POST   /seller/products/:productId/variants               (seller auth, APPROVED; attribute-validated)
GET    /seller/products/:productId/variants               (seller auth, allow-suspended)
GET    /seller/products/:productId/variants/:variantId    (seller auth, allow-suspended)
PATCH  /seller/products/:productId/variants/:variantId    (seller auth, APPROVED; attribute-validated)
POST   /seller/products/:productId/variants/:variantId/archive    (seller auth, APPROVED)
POST   /seller/products/:productId/variants/:variantId/unarchive  (seller auth, APPROVED)
DELETE /seller/products/:productId/variants/:variantId    (seller auth, APPROVED; soft)

# Variant images — presigned upload to Spaces, HEAD-verified register.
POST   /seller/variants/:variantId/images/presign (seller auth, APPROVED; 15-min TTL)
POST   /seller/variants/:variantId/images         (seller auth, APPROVED; queues thumbnail)
GET    /seller/variants/:variantId/images         (seller auth, allow-suspended)
DELETE /seller/variants/:variantId/images/:imageId (seller auth, APPROVED; queues original+thumb delete)

# CSV product/variant import + saved column mappings.
GET    /seller/csv-imports/template              (seller auth, allow-suspended)
POST   /seller/csv-imports/presign               (seller auth, APPROVED)
POST   /seller/csv-imports/preview               (seller auth, APPROVED)
POST   /seller/csv-imports/process               (seller auth, APPROVED; async worker)
GET    /seller/csv-imports                       (seller auth, allow-suspended)
GET    /seller/csv-imports/:id                   (seller auth, allow-suspended)
GET    /seller/csv-imports/:id/error-report      (seller auth, allow-suspended)
POST   /seller/csv-mappings                      (seller auth, APPROVED)
GET    /seller/csv-mappings                      (seller auth, allow-suspended)
GET    /seller/csv-mappings/:id                  (seller auth, allow-suspended)
PATCH  /seller/csv-mappings/:id                  (seller auth, APPROVED)
DELETE /seller/csv-mappings/:id                  (seller auth, APPROVED; soft)
```

Notes:
- Property inheritance (weight/dims/declared-value/HS/GST) resolves
  variant → product → category → `system_settings` (GST only). All
  cross-module variant reads MUST go through `CatalogReadService`.
- Attribute inheritance: a category's effective attribute set = its own
  defs + every ancestor's, child overrides parent on the same key;
  cached in Redis 5 min, descendant-invalidated on write.
- Background jobs (in-process BullMQ): thumbnail generation, image
  orphan-sweep (daily 03:15 UTC), CSV import processing.
- GST is whole-percent in Phase 1A; CSV imports are idempotent
  (PATCH-by-diff, re-upload-safe). See `docs/phase-1a-debt.md`.

See `docs/phase-1a-debt.md` for tracked deferrals.
