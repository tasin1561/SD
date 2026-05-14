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
| Storage | DigitalOcean Spaces (S3-compatible, SGP1 region) |
| Auth | Custom: Passport.js + JWT (no Clerk/Auth0/Supabase) |
| Email | TBD between Resend / Postmark (deciding at auth module design) |
| SMS | Twilio (TBD on click-to-call integration timing) |
| Live chat | ChatWoot self-hosted (separate droplet, deferred) |
| Monorepo | Turborepo + pnpm workspaces |
| Node | 22.x (engines enforced in package.json) |
| Package manager | pnpm 11.x |

---

## Repo Structure

```
SD/
├── apps/
│   ├── marketing/         # skydrop.online — public marketing site
│   ├── seller/            # app.skydrop.online — seller dashboard
│   ├── admin/             # admin.skydrop.online — internal staff
│   ├── track/             # track.skydrop.online — public tracking page (EN+HI)
│   ├── api/               # api.skydrop.online — NestJS REST API
│   └── workers/           # BullMQ background workers
├── packages/
│   ├── db/                # ✅ Prisma + types (@skydrop/db) — BUILT
│   ├── ui/                # shared React components
│   ├── types/             # shared TS types (DTOs, enums beyond DB)
│   ├── config/            # shared eslint/tsconfig/tailwind presets
│   ├── i18n/              # translations (en/hi for track, en/bn for seller)
│   └── utils/             # shared utilities (date, money, phone, etc.)
├── docker/                # docker-compose.yml for local Postgres + Redis
├── docs/
│   ├── infrastructure.md  # provisioning + ops reference
│   └── db-schema.md       # canonical schema spec (the source of truth)
└── CLAUDE.md              # this file
```

Apps and packages are placeholder folders (README only) until their respective modules are scaffolded. Only `packages/db` is currently a real package.

---

## Database

**Status: IMPLEMENTED.** Schema lives in `packages/db/`.

**Canonical reference:** `docs/db-schema.md` — 62 Prisma models across 9 layers (identity, addresses, catalog, inventory/WMS, orders, call center, shipments, pricing, notifications). When the schema and this doc diverge, the doc wins; update Prisma to match.

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

### Service-Layer Rules (MUST enforce in code — schema cannot)

The schema gives you the shape; these rules give you correctness. Violating them creates data corruption that's expensive to detect and harder to fix.

**Inventory rules:**
1. Stock changes are transactional. Movements + level updates + reservations all in one `prisma.$transaction`.
2. Optimistic concurrency on `stock_levels.version`. On conflict, refetch and retry.
3. `stock_movements` is append-only. NEVER UPDATE or DELETE rows.
4. Reservation cleanup is async (hourly BullMQ job releases past `expiresAt`).
5. FIFO/FEFO at pick time: `ORDER BY batches.expiresAt ASC NULLS LAST, batches.receivedAt ASC`.

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

**Outbound webhook rules:**
1. Sign every payload with HMAC-SHA256 using endpoint's `secretKey`.
2. Retry policy (BullMQ): 5 attempts, exponential backoff (30s, 5m, 30m, 6h).
3. Auto-disable endpoint after N consecutive failures (default 50, configurable via `system_settings`).
4. Idempotency: unique constraint on `(endpointId, eventType, eventId, attemptNumber)` prevents double-send.

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

### NestJS (when we get there)

- One module per business domain (`auth`, `sellers`, `orders`, `shipments`, ...).
- Module structure: `controllers/`, `services/`, `dto/`, `guards/`, `decorators/`.
- DTOs use `class-validator`. No raw request body access.
- Controllers thin (validation + dispatch). Services do the work.
- Services injectable, single-responsibility. Cross-module work via events (EventEmitter or BullMQ).
- Database access only via Prisma client, never raw SQL except in migrations.

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

---

## MUST / MUST NOT

### MUST

1. Read `docs/db-schema.md` before any code touching the database.
2. Read this `CLAUDE.md` at session start (you're doing it now).
3. Run `pnpm prisma format && pnpm prisma validate` after schema edits.
4. Run `pnpm tsc --noEmit` before committing.
5. Write tests for service-layer rules (state machines, transactions, idempotency).
6. Use the `prisma` singleton from `@skydrop/db`, never `new PrismaClient()`.
7. Wrap multi-write operations in `prisma.$transaction`.
8. Use BullMQ for async work (notifications, webhook delivery, cleanup jobs). No background work in HTTP request handlers.
9. Snapshot data when immutability matters (order recipient address, order item SKU info, shipment dest address).

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
| 1 | Auth & Access Control (staff + seller, refresh, password reset, email verify, API keys) | NEXT |
| 2 | Seller Onboarding (invite, registration, approval workflow) | pending |
| 3 | Seller Profile (settings, addresses, notification preferences) | pending |
| 4 | Product/SKU Catalog (categories, products, variants, images, CSV upload) | pending |
| 5 | Inventory & WMS (warehouses, bins, batches, levels, movements, reservations, receiving, cycle counts) | pending |
| 6 | Order Management (manual entry, CSV upload, lifecycle, events) | pending |
| 7 | Call Center Workflow (queue, distributor, attempt logging) | pending |
| 8 | Warehouse Operations (pick, pack, dispatch, RTO) | pending |
| 9 | Courier Integration (Delhivery API + manual placement workflow) | pending |
| 10 | Public Tracking Page (EN + HI) | pending |
| 11 | Notifications (templates, dispatcher, throttle, BullMQ workers) | pending |
| 12 | Admin Dashboard (seller approval, order ops, warehouse ops, queue management) | pending |
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

## Current State (2026-05-14)

**Implemented:**
- Infrastructure (DO droplet, managed Postgres, Spaces, Cloudflare)
- Local dev (WSL2, Docker Postgres + Redis with TimescaleDB)
- Monorepo skeleton (Turborepo + pnpm)
- `@skydrop/db` package: 62 Prisma models, initial migration with TimescaleDB hypertables, idempotent seed (system settings, couriers, FX, warehouse, rate card, notification templates)

**Not yet implemented:**
- `apps/api` (the NestJS API)
- All other apps and packages (placeholders only)
- Any feature module (auth, sellers, orders, etc.)

**Next:** Module 1 — Auth & Access Control. Design happens in chat with the user; implementation by Claude Code in a focused session per module.

---

## Session Hygiene

- Each module is a fresh Claude Code session. Don't carry context across modules — context loads from this file + the schema doc + the relevant code.
- Session sequence:
  1. User and assistant design module in chat (decisions, scope, file structure).
  2. User pastes a focused prompt into a fresh Claude Code session.
  3. Claude Code reads `CLAUDE.md`, `docs/db-schema.md`, and the prompt; proposes a plan.
  4. User reviews plan, approves or refines.
  5. Claude Code executes, verifies, commits, pushes.
  6. User reports back to chat assistant with summary.
  7. Repeat for next module.

- Long sessions (30+ min, many tool calls) get expensive in context. End sessions when a logical unit completes.
- After every session, the assistant updates this `CLAUDE.md` if anything material changed.
