# Skydrop — Claude Code Context

This file is loaded at the start of every Claude Code session. Read it carefully — the rules and conventions here are not optional.

---

## What is Skydrop

Skydrop is a **cross-border courier aggregator + light WMS** for Bangladeshi e-commerce sellers shipping to Indian customers.

**Flow:** BD seller ships stock → Skydrop's Indian warehouse receives + holds inventory → end customer in India places order → Skydrop's call center confirms the order by phone (COD culture in India means call confirmation is essential) → warehouse picks/packs → dispatched via Delhivery (primary courier, API-integrated) or manually placed with backup couriers when Delhivery rejects → tracking + RTO handling → delivery.

**Positioning:** We are the operational backbone (warehouse + customer call + courier dispatch + tracking) so BD sellers can sell into India without having Indian operations themselves.

---

## Phase 1A — Scope

Phase 1A covers **everything except billing/wallet/remittance**. Specifically:

**IN SCOPE (Phase 1A):**
- Seller onboarding (invite-only)
- Product/SKU catalog with categories, variants, images
- Inventory & WMS (multi-bin, batches, reservations, append-only ledger, FIFO/FEFO picking)
- Order management (single + bulk CSV upload)
- Call center workflow (round-robin queue, attempt logging, outcome capture)
- Warehouse operations (receive, pick, pack, dispatch, RTO handling)
- Courier integration: Delhivery (full API) + manual placement for non-integrated couriers
- Shipment tracking with TimescaleDB-backed event log
- Public tracking page (English + Hindi)
- Notifications (transactional email + SMS + in-app)
- Admin dashboard
- Reports (operational, not financial)
- System settings (admin-editable runtime config)
- Pricing engine (calculate charges, no billing yet)
- Multi-currency (INR canonical, BDT display) + FX
- Order charges breakdown (line items with computation context)
- Live chat (ChatWoot self-hosted, separate droplet — deferred install)
- Outbound webhooks for seller B2B integration

**OUT OF SCOPE (deferred to Phase 1B):**
- Seller wallet + ledger
- GST-compliant invoicing
- Payment gateway top-up
- COD reconciliation
- Cross-border remittance
- Historical FX rate tracking

**OUT OF SCOPE (deferred to Phase 2+):**
- Click-to-call integration (manual logging in 1A)
- Call recording storage
- Live driver GPS tracking
- Customer authentication (public tracking only in 1A)
- Notification template versioning
- Multi-warehouse routing logic

**Do not implement Phase 1B/2 features in Phase 1A modules unless explicitly asked. Schema is forward-compatible — don't add deferred features just because the columns exist.**

---

## Stack (LOCKED — do not propose alternatives)

| Layer | Choice |
|---|---|
| Frontend | Next.js 15 App Router + TypeScript + Tailwind + shadcn/ui |
| Backend | NestJS + Prisma + REST/OpenAPI |
| Database | PostgreSQL 18 (DO Managed in prod, Docker local) + TimescaleDB extension |
| ORM | Prisma 6.x (pinned at 6.19.3 — do not upgrade to 7.x without approval) |
| Queue | BullMQ on Redis |
| Cache | Redis (also droplet-local in prod) |
| Storage | DigitalOcean Spaces (S3-compatible, SGP1 region) via @aws-sdk/client-s3 |
| Auth | Custom: Passport.js + JWT (no Clerk/Auth0/Supabase) |
| Email | Resend (via `resend` npm package; templates in DB rendered with Nunjucks) |
| SMS | Twilio (TBD on click-to-call integration timing) |
| Live chat | ChatWoot self-hosted (separate droplet, deferred) |
| Monorepo | Turborepo + pnpm workspaces |
| Node | 22.x (engines enforced in package.json) |
| Package manager | pnpm 11.x |
| CSV parsing | papaparse |
| Image processing | sharp (thumbnail generation) |
| Rate limiting | @nestjs/throttler + @nest-lab/throttler-storage-redis |

---

## Repo Structure

```
SD/
├── apps/
│   ├── marketing/         # skydrop.online — public marketing site (placeholder)
│   ├── seller/            # app.skydrop.online — seller dashboard (placeholder)
│   ├── admin/             # admin.skydrop.online — internal staff (placeholder)
│   ├── track/             # track.skydrop.online — public tracking page (EN+HI) (placeholder)
│   ├── api/               # ✅ api.skydrop.online — NestJS REST API
│   └── workers/           # BullMQ background workers (placeholder; Phase 1A workers are in-process in apps/api)
├── packages/
│   ├── db/                # ✅ Prisma + types (@skydrop/db)
│   ├── ui/                # shared React components (placeholder)
│   ├── types/             # shared TS types (placeholder)
│   ├── config/            # shared eslint/tsconfig/tailwind presets (placeholder)
│   ├── i18n/              # translations (placeholder)
│   └── utils/             # shared utilities (placeholder)
├── docker/                # docker-compose.yml for local Postgres + Redis
├── docs/
│   ├── infrastructure.md  # provisioning + ops reference
│   ├── db-schema.md       # canonical schema spec (the source of truth)
│   └── phase-1a-debt.md   # explicit Phase 1A deferrals tracked here
└── CLAUDE.md              # this file
```

---

## Database

**Status: IMPLEMENTED.** Schema lives in `packages/db/`.

**Canonical reference:** `docs/db-schema.md`. Currently **69 Prisma models** across 9 layers plus per-module additions (seller_onboarding_progress in M2; category_proposals, category_attribute_definitions, seller_csv_mappings, bulk_product_uploads in M4; stock_alert_state, stock_adjustment_lines in M5). When the schema and this doc diverge, the doc wins; update Prisma to match.

**Migrations applied:** 7 as of Module 5 (init, audit_logs entityId nullable, sellers email_verified_at/last_login_at, seller_onboarding_progress, catalog proposals/attributes/csv_mappings/bulk_product_uploads, stock_thresholds_and_alert_state_table, bump_stock_reservation_ttl_default, stock_adjustment_lines).

**TimescaleDB hypertables:** `tracking_events` and `stock_movements` (composite PK, monthly chunks, 7d/30d compression).

**Consumption pattern:**

```ts
import { prisma, OrderStatus, ShipmentStatus } from '@skydrop/db';

const order = await prisma.order.findUnique({
  where: { id },
  include: { items: true, events: true },
});
```

The package exports a singleton `prisma` client (configured logging, graceful shutdown) and re-exports every enum.

**Hypertable schema convention:** Any future hypertable needs explicit `@@index([createdAt], map: "<table>_created_at_idx")` declared in Prisma so the index name matches what TimescaleDB's `create_hypertable()` would auto-create. The migration's explicit `CREATE INDEX` must run BEFORE `create_hypertable()`. This prevents Prisma drift detection from breaking on hypertable conversions.

**Workspace pattern:** `@skydrop/db` builds to `dist/` and consumers import compiled output. `turbo.json` wires `^build` as a dep of `dev`, `typecheck`, `lint`, `test`, `test:e2e` so apps/api always sees a built db package.

**Critical: build script auto-runs `prisma generate` first.** `pnpm --filter @skydrop/db build` is `prisma generate && tsc`. Turbo's `^build` does NOT imply `generate`, so the build script chains them explicitly. Fresh clones and CI runs depend on this. When adding a new enum to schema.prisma, also add it to `packages/db/src/enums.ts` (hand-maintained re-export list).

### Service-Layer Rules (MUST enforce in code — schema cannot)

The schema gives you the shape; these rules give you correctness. Violating them creates data corruption that's expensive to detect and harder to fix.

**Order rules:**
1. Status transitions enforced by a state machine in code (22 statuses; not every transition is valid).
2. Order numbers via Postgres SEQUENCE per year (`SD-YYYY-NN-XXXXXX`).
3. Recipient address is immutable on order — snapshot at create, never re-link.

**Shipment rules:**
1. Webhook idempotency: dedup key is `(courierCode, awbNumber, eventType, externalEventId)`. Duplicate webhooks stored (audit) but produce no duplicate tracking events.
2. Status transitions enforced by state machine (16 statuses).
3. AWB lifecycle: when superseded (e.g., Delhivery rejected → Bluedart), new shipment gets new AWB. Never reassign.
4. Webhook receipt acknowledged ASAP: write raw row, return HTTP 200 within 500ms, process async via BullMQ.

**Credential rules:**
1. Decryption key NEVER in DB. Always env var (`COURIER_CREDENTIALS_KEY_<version>`).
2. Every decrypt writes an `audit_logs` row before returning plaintext.
3. Plaintext credentials are NEVER logged, NEVER serialized to API responses, NEVER cached longer than 5 min.

**Pricing rules:**
1. Calculate charges at order creation, not display time. Persist to `order_charges` with full `computationContext` JSON.
2. GST (18%) applies after all surcharges: `gst = (baseShipping + sum(surcharges)) * 0.18`.
3. Historical accuracy: past orders show charges as persisted. Don't recompute from current rate cards.

**Notification rules:**
1. Send via BullMQ workers only. API endpoints enqueue; workers send.
2. Throttle per (recipient, template). Check `notification_logs` before send; mark THROTTLED if limit exceeded.
3. Respect seller's quiet hours for non-urgent categories.
4. Fire-once dedup queries `notification_logs` by `(templateCode, recipientType, recipientId)` — NotificationLog is polymorphic, no direct `sellerId` field.

**Outbound webhook rules:**
1. Sign every payload with HMAC-SHA256 using endpoint's `secretKey`.
2. Retry policy (BullMQ): 5 attempts, exponential backoff (30s, 5m, 30m, 6h).
3. Auto-disable endpoint after N consecutive failures (default 50, configurable via `system_settings`).
4. Idempotency: unique constraint on `(endpointId, eventType, eventId, attemptNumber)` prevents double-send.

**Status-change rules (general):**
1. Any status-change service wraps update + side-effects (token revoke, note, audit, email enqueue) in one `prisma.$transaction`.
2. Email enqueue happens INSIDE the transaction. Phantom-job edge case (commit fails after enqueue) handled by consumer-side idempotency.
3. Strict transition guards: each direction has exactly one valid source state. No "any → any" transitions.

**Catalog rules (Module 4):**
1. **CatalogReadService is the only sanctioned path for cross-module variant reads.** Downstream modules (Inventory, Orders, Shipments, Couriers) MUST import `CatalogReadService` via NestJS DI. Never query `ProductVariant` directly from outside the catalog modules. Property resolution (effective weight, dims, value, HS, GST) is centralized there.
2. **Property inheritance order:** variant.field → product.defaultField → category.defaultField → system_settings (GST only). Other properties have no system fallback — null all the way down = validation error.
3. **Attribute inheritance:** walks `parent_id` chain; child overrides parent for same `attribute_key`. Cached in Redis 5-min TTL; invalidation on write walks descendants.
4. **Variant attribute validation:** required attributes present, valueType matches, ENUM in allowedValues, no extra keys, no nested objects/arrays in values.
5. **Image lifecycle:**
   - Registered: row alive, Spaces object alive
   - Soft-deleted: `row.deletedAt` set, object preserved (recoverable)
   - Hard-deleted (Phase 2 cron): row gone, object deleted together
   - Never registered (orphan): no row → object > 24h → cleaned by orphan cron (skips `thumbnails/` prefix)
6. **Presigned URL security:** key path must match `sellers/{sellerId}/variants/{variantId}/{token}.{ext}`; service validates seller segment matches authenticated seller; HEAD verifies object exists and size matches before registering.
7. **CSV re-upload PATCH semantics:** CSV-provided cells overwrite; omitted/blank cells do not null out existing values. Dedup by `(sellerId, externalRef)` for products, `(sellerId, skuCode)` for variants.
8. **Archive vs delete:** ARCHIVED status blocks new uses (orders, stock receiving) — enforce in service layer; `deletedAt` makes the row invisible in read paths. Both preserve historical references.

**Inventory rules (Module 5) — INV-1 through INV-9 are NON-NEGOTIABLE:**

1. **INV-1: StockMutationService is the only writer** of `stock_movements` and `stock_levels.qtyOnHand`. Every stock change goes through `apply(tx, input)`. `runWithRetry` wraps the whole tx, ≤3 attempts on a `stock_levels.version` clash → 409 `STOCK_CONCURRENCY_CONFLICT`.

2. **INV-2: Cache is reads-only for displays.** Mutation/decision paths call `StockReadService.getVariantStockLive()` (no cache) or directly use `StockAvailabilityService.compute()`. Cache-backed methods are named `*ForDisplay`/`*Summary`. **The method-name split IS the contract.** Cache invalidation runs AFTER `tx.commit()`, never inside.

3. **INV-3: `qtyAvailable` is computed, never stored.** Canonical formula:
   ```
   qtyAvailable = SUM(stock_levels.qtyOnHand)
                  − SUM(stock_reservations.qtyReserved WHERE status=ACTIVE)
   ```
   (phase-1 + phase-2 reservations counted uniformly). The canonical implementation lives in `StockAvailabilityService.compute()` (inventory-shared). All decision paths needing the scalar availability call this primitive directly.

4. **INV-4: `stock_levels.qtyReserved` counts phase-2 only.** Phase-1 reservations float in `stock_reservations` with NULL bin/batch. Pick allocation populates bin+batch AND increments `stock_levels.qtyReserved` (decrement on release/fulfill via clamped atomic UPDATE, no version needed for monotonic give-backs).

5. **INV-5: Cache invalidation + alert evaluation happen AFTER `tx.commit()`**, never inside the stock tx. Rollback must not leave stale cache or false alerts.

6. **INV-6: Optimistic concurrency retry ≤3**, then surface 409. `stock_levels.version` is the row's CAS token — protects both `qtyOnHand` mutations (StockMutationService) and `qtyReserved` increments (phase-2 populate). Clamped decrements bypass version.

7. **INV-7: `reasonCode` required** on `ADJUSTMENT_*` / `CYCLE_COUNT_ADJUST` / `EXPIRY_WRITE_OFF` movements.

8. **INV-8: Adjustments tx-wrapped.** Below-threshold initiate+execute in one tx; approval enqueues executor which runs in its own tx. Executor is idempotent on already-EXECUTED (no double-apply on BullMQ retry). Partial-failure rolls back entire tx; adjustment stays APPROVED for retry.

9. **INV-9: Alert state machine** (inactive/below → FIRE unless within cooldown → SUPPRESS+active; active/below → noop; active/ok → CLEAR; inactive/ok → noop) persisted in `stock_alert_state` per (seller, variant, warehouse).

**Reservation allocation is LATE (locked decision):** phase-1 soft qty claim at order confirm; phase-2 (bin+batch + version-CAS) at pick generation. `StockPickAllocationService.allocateAndPopulate()` is FULL-CONSUME (no partial-qty parameter; physical shortfall → residual phase-1 row; reserved-qty conserved). **Phase-1 over-claim window is inherent** — transient race condition under READ COMMITTED with no lock. Phase-2's version-CAS is the hard guard; conflicting allocation surfaces as `PICK_ALLOCATION_CONFLICT` to Module 8's escalation.

**Inventory module structure:**
- **inventory-shared** (internal infrastructure): `WarehouseResolverService`, `StockMutationService`, `StockAvailabilityService` (INV-3 primitive), `StockCacheService`, `StockAlertService`. Consumed by every inventory submodule.
- **inventory-stock** (cross-module surface): `StockReadService`, `StockReservationService`, `StockPickAllocationService`. **External consumers (Modules 6, 8) import this module and see only these three.** No other inventory services are exported externally.

**General:**
1. All money stored as `Decimal`, INR canonical. BDT for display only via FX.
2. All phone numbers E.164 (+91xxx, +880xxx). Validate at app boundary.
3. All timestamps UTC. Display timezone is a per-user preference.
4. Soft delete via `deletedAt` for user-facing data. Hard delete for tokens, sessions, transient/immutable rows.
5. Audit log every sensitive action via `audit_logs` (auth, admin actions, sensitive data access).

---

## Conventions

### Naming

- Folders & files: `kebab-case` (`order-confirmation.service.ts`)
- TypeScript classes, interfaces, types: `PascalCase`
- TypeScript variables, functions: `camelCase`
- Constants & env vars: `UPPER_SNAKE_CASE`
- Database tables: `snake_case` plural (`shipment_items`)
- Database columns: `snake_case`
- Prisma models: `PascalCase` singular, with `@@map` to snake_case table
- Enums in Prisma: `PascalCase`; values `UPPER_SNAKE_CASE` with `@map` to snake_case

### TypeScript

- `strict: true` always. `noUncheckedIndexedAccess: true`. `noImplicitOverride: true`.
- No `any` unless commented why (`// any: external lib has no types`).
- Prefer `type` for unions/aliases, `interface` for object shapes that may be extended.
- All exported functions get explicit return types.
- No barrel re-exports across module boundaries (no `import { x } from '@/modules'`). Import directly from the file.

### NestJS

- One module per business domain (`auth`, `sellers`, `orders`, `shipments`, ...).
- Module structure: `controllers/`, `services/`, `dto/`, `guards/`, `decorators/`.
- DTOs use `class-validator`. No raw request body access.
- Controllers thin (validation + dispatch). Services do the work.
- Services injectable, single-responsibility. Cross-module work via direct service injection in Phase 1A; consider events (EventEmitter or BullMQ) if circular dep emerges.
- Database access only via Prisma client, never raw SQL except in migrations.
- Sub-feature modules (profile, address, notification-preference under seller) provide guards locally rather than importing the auth module — keeps dep direction one-way.
- **Cross-module variant lookups** go via `CatalogReadService`. Cross-module catalog reads do NOT query the catalog tables directly.
- **Cross-module stock reads** go via the three exported services in `inventory-stock`: `StockReadService`, `StockReservationService`, `StockPickAllocationService`. Other inventory services (cache, alert, mutation, availability primitive) are internal to inventory and NOT exposed externally.

### Testing

- Unit tests use mocked Prisma (or in-memory fakes for transaction-sensitive logic).
- E2E tests run against the `skydrop_test` database (separate from dev) on logical Redis DB 1.
- E2E global setup creates DB, runs migrate deploy + seed; teardown drops DB.
- **Cascading reset helpers:** when adding a feature module with tables that FK to `sellers` (or any other reset-critical entity), add a `reset<Module>State()` helper and chain it BEFORE the parent reset (e.g., `resetAuthState`). Order-dependent test contamination is a real footgun without this. Each new module must do this proactively. Note: `resetInventoryState()` currently includes Order/OrderItem/Customer cleanup as interim coupling until Module 6 takes ownership.
- Use `makeTestEnv()` from the shared test helpers when constructing `EnvService` in tests; don't inline literal env objects (forces drift maintenance).
- For test fakes that need `prisma.$transaction(fn)`, attach `$transaction` AFTER the client literal to avoid TS7024 implicit-any from self-reference.

### Next.js (when we get there)

- App Router. Server Components by default; Client Components when needed (interactivity).
- Data fetching: Server Components call services directly or via fetch to internal API.
- No `getServerSideProps`/`getStaticProps` — we're on App Router.
- shadcn/ui components copied into `packages/ui` and re-exported.

---

## Git Workflow

- Solo dev for now. `main` branch, no feature branches required for trivial work.
- For larger features (anything spanning multiple commits in a logical unit), use a short-lived branch `feat/auth-module` etc. and merge to main via fast-forward.
- Commit messages: conventional commits — `feat(scope):`, `fix(scope):`, `chore(scope):`, `docs(scope):`, `refactor(scope):`, `test(scope):`.
- Multi-line commit messages with rationale for non-trivial changes.
- Push at end of each Claude Code session. Auto-push permitted per `.claude/settings.local.json`.
- NEVER force push to main. NEVER reset main. NEVER rewrite published history.
- Existing tests must stay green at every commit boundary. Update assertions in the same commit that flips behavior.

---

## MUST / MUST NOT

### MUST

1. Read `docs/db-schema.md` before any code touching the database.
2. Read this `CLAUDE.md` at session start (you're doing it now).
3. Read `docs/phase-1a-debt.md` to know what's intentionally deferred.
4. Run `pnpm prisma format && pnpm prisma validate` after schema edits.
5. Run `pnpm tsc --noEmit` before committing.
6. Write tests for service-layer rules (state machines, transactions, idempotency).
7. Use the `prisma` singleton from `@skydrop/db`, never `new PrismaClient()`.
8. Wrap multi-write operations in `prisma.$transaction`.
9. Use BullMQ for async work (notifications, webhook delivery, cleanup jobs). No background work in HTTP request handlers.
10. Snapshot data when immutability matters (order recipient address, order item SKU info, shipment dest address).
11. Add new enums to `packages/db/src/enums.ts` after adding them to `schema.prisma`.
12. When adding tables with FKs to existing entities, add a `reset<Module>State()` helper and chain it into the central e2e reset before the parent reset.
13. Use `CatalogReadService` for cross-module variant **reads**; never query `product_variants` directly from outside the catalog modules. *Clarification (Module 5): this governs cross-module READS so inheritance precedence stays centralized. A column owned by another domain that lives on a catalog table for storage convenience — e.g., inventory's `product_variants.low_stock_threshold` — may be written by the owning domain directly, with an explicit code comment; its reads still go via `CatalogReadService` as a raw passthrough.*
14. Use `makeTestEnv()` in test fixtures instead of inline literal env objects.
15. All stock writes go through `StockMutationService` (INV-1); never write `stock_movements` or `stock_levels.qtyOnHand` elsewhere. Honor INV-2 (cache reads-only via method-name split), INV-3 (use `StockAvailabilityService.compute()` for the canonical scalar), INV-4 (`qtyReserved` = phase-2 only). For cross-module stock needs, import only the three services exported by `inventory-stock`.

### MUST NOT

1. **NEVER** store API credentials in plaintext in the DB. Use `courier_credentials` with AES-256-GCM, key in env.
2. **NEVER** log passwords, API keys, credential plaintext, or full webhook signatures.
3. **NEVER** modify `stock_movements`, `tracking_events`, `call_attempts`, or `audit_logs` after insert.
4. **NEVER** use `db:reset` or `prisma migrate reset` in production-like environments without explicit approval.
5. **NEVER** install dependencies the user didn't approve. Ask first.
6. **NEVER** commit `.env` files (`.env.example` only).
7. **NEVER** push to a non-`main` remote branch without confirming the user wants it.
8. **NEVER** delete files without verifying nothing depends on them.
9. **NEVER** implement Phase 1B/2 features unless explicitly asked.

---

## Module Roadmap (18 modules)

Module order — each builds on prior modules:

| # | Module | Status |
|---|---|---|
| 0 | Database & Prisma package | ✅ DONE |
| 1 | Auth & Access Control (staff + seller, refresh, password reset, email verify, API keys) | ✅ DONE |
| 2 | Seller Onboarding (invite, registration, approval workflow) | ✅ DONE |
| 3 | Seller Profile (merged into Module 2) | ✅ DONE |
| 4 | Product/SKU Catalog (categories, products, variants, images, CSV upload) | ✅ DONE |
| 5 | Inventory & WMS (warehouses, bins, batches, levels, movements, reservations, receiving, cycle counts) | ✅ DONE |
| 6 | Order Management (manual entry, CSV upload, lifecycle, events) | NEXT |
| 7 | Call Center Workflow (queue, distributor, attempt logging) | pending |
| 8 | Warehouse Operations (pick, pack, dispatch, RTO) | pending |
| 9 | Courier Integration (Delhivery API + manual placement workflow) | pending |
| 10 | Public Tracking Page (EN + HI) | pending |
| 11 | Notifications (templates, dispatcher, throttle, BullMQ workers) | pending |
| 12 | Admin Dashboard (seller approval, order ops, warehouse ops, queue management, RBAC enforcement) | pending |
| 13 | Reports (operational, not financial) | pending |
| 14 | System Settings UI | pending |
| 15 | Pricing Engine (calculate only, no billing) | pending |
| 16 | Multi-Currency & FX | pending |
| 17 | Order Charges & Cost Breakdown UI | pending |
| 18 | Live Chat (ChatWoot integration) | pending (deferred droplet install) |

Phase 1B modules (not in this roadmap):
- Seller wallet
- GST invoicing
- Payment gateway
- COD reconciliation
- Cross-border remittance
- Historical FX

---

## Current State (2026-05-16)

**Implemented:**
- Infrastructure (DO droplet, managed Postgres, Spaces, Cloudflare)
- Local dev (WSL2, Docker Postgres + Redis with TimescaleDB)
- Monorepo skeleton (Turborepo + pnpm)
- `@skydrop/db` package: 69 Prisma models, 7 migrations applied, idempotent seed (system settings, couriers, FX, warehouse, rate card, 24 notification templates)
- `apps/api` (NestJS): config (Zod-validated), Prisma module, Redis module, health endpoints, Swagger at /api/docs, Pino logging with redaction, global exception filter, request-id middleware, rate limiting, multiple BullMQ workers in-process (email, image-thumbnail, image-orphan-cleanup, csv-import-processor, reservation-cleanup, adjustment-executor)
- **Module 1** — Auth & Access Control: staff + seller auth, refresh rotation with replay detection, invitations, API keys, email module with Resend + Nunjucks, audit logging via `AuditLogService`
- **Module 2** — Seller Onboarding (also covers Module 3 scope): seller status transitions, `SellerOnboardingService` with step tracking, profile + bank details endpoints, address CRUD, notification preferences with registration pre-seed, admin seller management endpoints
- **Module 4** — Product/SKU Catalog: admin category tree with full-path maintenance + cycle prevention, attribute definition CRUD with inheritance resolution (5-min Redis cache, descendant invalidation), category proposals (seller propose → admin approve), product/variant CRUD with attribute validation, presigned URL image uploads to Spaces with thumbnail generation + orphan cleanup, CSV import with template + auto-detect + preview + idempotent re-upload, saved column mappings, `CatalogReadService` as sanctioned cross-module variant read boundary
- **Module 5** — Inventory & WMS: warehouse/zone/bin CRUD; `StockMutationService` (sole writer, version-CAS retry); `StockAvailabilityService` (INV-3 canonical scalar); two-path `StockReadService` (live vs cached, INV-2); LATE reservations (phase-1 reserve/release/fulfill → phase-2 FEFO+single-batch allocate with conservation invariants); hourly auto-release worker; goods receipts (declare → receive → complete / DISCREPANCY → resolve); threshold-gated adjustments (auto-execute below / approve→executor worker above); cycle counts (→ draft CYCLE_COUNT adjustments); `StockAlertService` state machine + cooldown (`stock_alert_state` table). Cross-module surface (Modules 6, 8): `StockReadService`, `StockReservationService`, `StockPickAllocationService`. Module 5 captured INV-1 through INV-9 as non-negotiable service-layer invariants codified above.
- Test totals: 305 unit + 21 e2e tests, all green; fresh-clone simulation verified

**Not yet implemented:**
- All other apps (frontends in `apps/marketing`, `apps/seller`, `apps/admin`, `apps/track` are placeholders)
- Modules 6-18

**Next:** Module 6 — Order Management. Will consume Module 5's exported services (`StockReadService`, `StockReservationService`) at order confirmation. Will own the 22-status order state machine, manual order entry, bulk CSV upload, recipient address snapshotting, order events ledger. Design happens in chat with the user before implementation.

---

## Session Hygiene

- Each module is a fresh Claude Code session. Don't carry context across modules — context loads from this file + the schema doc + the phase-1a-debt doc + the relevant code.
- Session sequence:
  1. User and assistant design module in chat (decisions, scope, file structure).
  2. User pastes a focused prompt into a fresh Claude Code session.
  3. Claude Code reads `CLAUDE.md`, `docs/db-schema.md`, `docs/phase-1a-debt.md`, and the prompt; proposes a plan.
  4. User reviews plan, approves or refines.
  5. Claude Code executes, verifies, commits, pushes.
  6. User reports back to chat assistant with summary.
  7. Repeat for next module.

- Long sessions (30+ min, many tool calls) get expensive in context. End sessions when a logical unit completes.
- Multi-checkpoint pacing for big modules. Use checkpoints when the module spans 15+ commits.
- After every session, the assistant updates this `CLAUDE.md` if anything material changed.
- Mid-module checkpoints when security-critical or data-integrity-critical work lands. Mechanical CRUD can run end-to-end without interruption.
- **Pre-flight reviews catch real problems.** Module 5 surfaced 4 findings pre-implementation (FK constraint, alert grain mismatch, adjustment intent gap, refactor circular dep) — each would have caused painful rework if discovered post-code. When Claude Code proposes a plan, scrutinize it before approval.
