# Skydrop — Master Spec for Claude Code

> **READ THIS FILE FIRST in every session.** It is the single source of truth for the Skydrop project. If anything here conflicts with what's in the codebase, the codebase is wrong — ask the user before changing this spec.

---

## 1. What Skydrop Is

Skydrop is a **cross-border courier aggregator + light WMS** built for Bangladeshi e-commerce sellers shipping to Indian customers.

**Business flow:**

1. Bangladeshi seller signs up (invite-only) → admin approves
2. Seller ships stock from BD to Skydrop's warehouse in India (cross-border, handled offline)
3. Warehouse staff receives stock against seller's SKU catalog → inventory tracked per seller per SKU per bin
4. Seller submits parcel order (single or bulk CSV) → linked to SKUs in catalog
5. Call center calls Indian customer to confirm COD order
6. Confirmed order → auto-push to Delhivery API → AWB returned, label printed
7. If Delhivery rejects → goes to manual placement panel → admin uses another Indian courier
8. Warehouse picks → packs → hands to courier rider
9. Delivery tracked via Delhivery webhook (Delhivery orders) or manually (other couriers)
10. Customer sees branded tracking at `track.skydrop.online/[id]` (English + Hindi)

**Phase 1A scope** (current): everything except automated wallet/invoicing/collection/remittance — those are deferred to Phase 1B. Phase 1A handles money flows manually offline.

**Phase 1B scope** (later): seller wallet + ledger, GST-compliant invoicing, payment gateway top-up, COD reconciliation, cross-border remittance to BD.

---

## 2. Stack — IMMUTABLE

Do NOT swap technologies without explicit user approval. These are locked.

- **Language:** TypeScript everywhere (strict mode)
- **Frontend:** Next.js 15 (App Router) + Tailwind CSS + shadcn/ui
- **Backend:** NestJS + Prisma ORM + REST API + OpenAPI/Swagger
- **Database:** PostgreSQL 18 (DigitalOcean Managed) with PostGIS + TimescaleDB extensions
- **Cache / Queue:** Redis + BullMQ
- **Storage:** DigitalOcean Spaces (S3-compatible)
- **Auth:** Custom — Passport.js + JWT + refresh tokens, bcrypt, RBAC. No Clerk, no Auth0, no Supabase Auth.
- **Email:** Resend or Postmark (TBD — `EMAIL_PROVIDER` env var)
- **SMS:** Twilio
- **Live chat:** ChatWoot (self-hosted, separate small droplet)
- **Monorepo:** Turborepo + pnpm workspaces
- **Hosting:** DigitalOcean Droplet (Bangalore BLR1) + Managed Postgres (BLR1) + Spaces (SGP1) + Cloudflare edge

---

## 3. Repo Structure

```
SD/
├── apps/
│   ├── marketing/      # Next.js — skydrop.online (public marketing)
│   ├── seller/         # Next.js — app.skydrop.online (seller portal)
│   ├── admin/          # Next.js — admin.skydrop.online (staff portal)
│   ├── track/          # Next.js — track.skydrop.online (branded tracking page)
│   ├── api/            # NestJS — api.skydrop.online (backend)
│   └── workers/        # Node — BullMQ workers (emails, webhooks, status sync)
│
├── packages/
│   ├── db/             # Prisma schema + generated client + migrations
│   ├── ui/             # Shared shadcn/ui components
│   ├── types/          # Shared TypeScript types (DTOs, enums, etc.)
│   ├── config/         # Shared ESLint, TS, Tailwind config
│   ├── i18n/           # Translations (English + Hindi for tracking page)
│   └── utils/          # Pure utility functions
│
├── docker/             # docker-compose files for local dev (Postgres + Redis + ChatWoot)
├── infra/              # Server provisioning scripts, nginx configs, deployment helpers
├── docs/               # Architecture decisions, runbooks, API docs
├── .github/            # CI workflows (later)
│
├── CLAUDE.md           # ← this file
├── README.md
├── .gitignore
├── package.json        # Workspace root
├── pnpm-workspace.yaml
├── turbo.json
└── tsconfig.base.json
```

---

## 4. Conventions

### Naming
- **Folders / files:** `kebab-case` (`order-service.ts`, `shipment-list/`)
- **TypeScript types / interfaces / classes:** `PascalCase` (`Shipment`, `CreateOrderDto`)
- **Variables / functions:** `camelCase` (`createOrder`, `pendingShipments`)
- **Constants / env vars:** `UPPER_SNAKE_CASE` (`MAX_RETRIES`, `DATABASE_URL`)
- **DB tables:** `snake_case`, plural (`shipments`, `tracking_events`, `call_logs`)
- **DB columns:** `snake_case` (`created_at`, `seller_id`)
- **Prisma models in code:** `PascalCase` singular (`Shipment`, `TrackingEvent`)

### Git
- Branch from `main`. Feature branches: `feat/<short-name>`, `fix/<short-name>`, `chore/<short-name>`
- Commit messages: **Conventional Commits** — `feat:`, `fix:`, `chore:`, `docs:`, `refactor:`, `test:`
- Examples:
  - `feat(orders): add bulk CSV upload endpoint`
  - `fix(auth): handle expired refresh tokens correctly`
  - `chore(deps): bump prisma to 6.1.0`
- One logical change per commit. Don't pile 20 unrelated fixes into one commit.

### TypeScript
- `"strict": true` in every tsconfig. No exceptions.
- No `any`. Use `unknown` and narrow. If absolutely necessary, comment why.
- Shared DTOs/types live in `packages/types`, not duplicated across apps.
- All Prisma queries are wrapped in service methods, never raw in controllers.

### NestJS API
- Each domain = its own module (`OrdersModule`, `ShipmentsModule`, `SellersModule`, etc.)
- Controller → Service → Repository (Prisma client) layering
- DTO validation via `class-validator` + `class-transformer`
- Auth guards: `@JwtAuthGuard`, `@RolesGuard(['admin', 'call_agent'])`, `@SellerScopeGuard`
- All async functions return typed Promises. No `void` unless truly fire-and-forget.

### Next.js apps
- App Router only. No Pages Router code.
- Server Components by default. `'use client'` only when needed (forms, interactivity).
- Tailwind for styling. shadcn/ui for components. No CSS-in-JS, no Sass.
- Data fetching: server actions or RSC `fetch` for reads; server actions or API calls for writes.
- Subdomain-based deployment: each app builds independently, deployed under its own Nginx server block.

### Database
- ALL money stored as `Decimal` in Postgres (`@db.Decimal(12, 2)`), canonical currency **INR**.
- ALL timestamps in UTC (`DateTime` in Prisma → `timestamp with time zone` in Postgres).
- ALL phone numbers stored as `String` in **E.164** format (`+91...` / `+880...`).
- Soft delete preferred for sellers, customers, orders (status flag, not DELETE).
- Always add indexes on FK columns + commonly queried fields (status, created_at).
- `tracking_events` table → TimescaleDB hypertable partitioned by `created_at`.

### Error handling
- API errors: structured JSON `{ code, message, details? }` with proper HTTP status
- Never expose internal errors to clients (stack traces, DB errors, etc.)
- Log everything via Pino with structured fields (`{ userId, orderId, ... }`)
- Background jobs: catch errors, log, retry per BullMQ policy, dead-letter after N retries

---

## 5. Phase 1A Modules (18 total)

Build order (rough — confirm with user before starting each):

1. **Auth & Access** — seller auth + admin auth with RBAC, JWT, invite system
2. **Seller Onboarding & Management** — admin-side approval flow
3. **Seller Profile** — BD company info, bank details (Phase 1B usage), API keys
4. **Product / SKU Catalog** — seller-managed SKUs with bulk CSV upload
5. **Inventory / WMS** — full stock per seller per SKU per bin, receiving, movements, adjustments
6. **Order Management** — single + bulk CSV order creation, list, filter, search
7. **Call Center Workflow** — call queue, agent UI, call logs, outcomes, retry logic
8. **Warehouse Operations** — pick queue, pack confirmation, AWB label printing, dispatch
9. **Courier Integration** — Delhivery API + webhook receiver + manual fallback panel
10. **Public Tracking Page** — branded `track.skydrop.online/[id]`, EN + HI, mobile-first
11. **Notifications** — SMS, email, in-app (BullMQ-driven)
12. **Admin Dashboard** — KPIs, breakdowns by seller/courier/branch
13. **Reports** — exportable CSV/Excel reports
14. **System Settings** — roles, audit logs, API keys, retry policies
15. **Pricing Engine** — rate cards, surcharges, GST 18%, per-seller contract pricing — **calculation + display only, no billing**
16. **Multi-Currency & FX** — INR canonical, BDT display, historical FX preservation
17. **Order Charges / Cost Breakdown** — line-item charges per order, foundation for Phase 1B billing
18. **Live Chat** — ChatWoot self-hosted, embedded in seller portal

**Explicitly OUT of Phase 1A** (do not build, do not plan around):
- ❌ Seller wallet, prepaid balance, ledger
- ❌ Invoicing (GST-compliant or otherwise)
- ❌ Payment gateway top-up / collection
- ❌ COD reconciliation, automated remittance to BD sellers
- ❌ Live GPS tracking (drivers)
- ❌ Driver mobile app
- ❌ Multi-warehouse (single warehouse only in Phase 1A)
- ❌ Outbound webhooks for sellers (only inbound API key for now)

---

## 6. Subdomain Map

| Subdomain | App | Audience |
|---|---|---|
| `skydrop.online` | `apps/marketing` | Public, prospects |
| `app.skydrop.online` | `apps/seller` | BD sellers (authenticated) |
| `admin.skydrop.online` | `apps/admin` | Staff (super admin, call agents, warehouse, etc.) |
| `track.skydrop.online` | `apps/track` | Indian end customers (public, no auth) |
| `api.skydrop.online` | `apps/api` | All apps + B2B API clients |

All proxied through Cloudflare → Nginx on droplet → respective Node app on internal port.

---

## 7. Roles & Permissions (RBAC)

- **`super_admin`** — full access, manages everything
- **`seller_approval_admin`** — can approve/reject seller signups, view seller profiles
- **`call_agent`** — sees only assigned call queue, can log call outcomes, cannot edit orders directly
- **`warehouse_staff`** — sees pick queue, can mark packed/dispatched, manage stock receiving
- **`manual_placement_admin`** — handles Delhivery-rejected orders, assigns to alt couriers, enters AWB
- **`finance`** — placeholder for Phase 1B (read-only access to charges/reports)
- **`seller`** — sees only their own data (sellers are scoped at the data level, not just role)

Data scoping is enforced by guards: a `call_agent` querying orders sees only ones assigned to them; a seller sees only their orders.

---

## 8. Infrastructure (already provisioned — see `docs/infrastructure.md`)

- **Droplet:** Ubuntu 24.04, Bangalore BLR1, 4GB/2vCPU/120GB NVMe, hardened (UFW, fail2ban, no root SSH, no password auth)
- **Postgres:** Managed, Bangalore BLR1, PG 18, 1GB/1vCPU/10GB + autoscale storage
- **Spaces:** Singapore SGP1 (BLR unavailable), `skydrop-storage` bucket with CDN, restricted listing
- **Redis:** to be installed on droplet (Phase 1A)
- **Cloudflare:** DNS proxied for all subdomains, SSL Full (strict)

Local dev uses Docker Compose for Postgres + Redis. Never connect to prod DB from local.

---

## 9. Workflow with Claude Code

This is a **solo developer** project. The user is `tasin1561` / Talha / Syed. The workflow:

1. User comes to Claude Code with a task (a module to build, a bug to fix, a feature to add)
2. Claude Code reads relevant files + this `CLAUDE.md` + any module-specific `CLAUDE.md`
3. Claude Code **plans first** for non-trivial work — describes intent before editing files
4. Claude Code executes — writes code, runs migrations, runs tests, commits
5. User reviews diffs in `git diff`, asks for changes, or merges

**Claude Code MUST:**
- Read this file fully at the start of every session
- Read module-specific `CLAUDE.md` if it exists in the relevant `apps/*` or `packages/*` directory
- Use `pnpm`, never `npm install` for dependencies (the workspace uses pnpm)
- Run `pnpm typecheck` and `pnpm lint` after meaningful changes (when scripts exist)
- Use Conventional Commits
- Never commit secrets — verify `.env` files are gitignored before adding files
- Ask before touching: production DB connection strings, infra/, deployment scripts, this CLAUDE.md
- Ask before deleting any file or table

**Claude Code MUST NOT:**
- Swap technologies without explicit approval
- Add a new top-level dependency without discussing it
- Introduce a new app or package without confirming structure
- Bypass conventions in this file
- Run `prisma migrate reset` or `prisma db push` without confirmation
- Modify migrations that are already applied to a real database

---

## 10. Open Decisions (TBD — flag if encountered)

- Email provider final pick (Resend vs Postmark) — decide before notifications module
- SMS provider for India (Twilio confirmed for now; may reconsider for cost)
- FX rate source (`exchangerate.host` vs Open Exchange Rates) — pick before pricing module
- ChatWoot version + hosting droplet sizing — decide before live chat module
- E-invoicing portal integration — Phase 1B, deferred

---

## 11. Reference Documents

- `docs/infrastructure.md` — full infra spec (this is the canonical source for hosting details)
- `docs/phase-1a-modules.md` — detailed module breakdown (when created)
- `docs/api-conventions.md` — API design conventions (when created)
- `docs/db-schema.md` — DB schema notes and rationale (when created)

If any of these don't exist yet, that's because we haven't gotten to them. Don't fabricate references.

---

**Last updated:** Setup phase (pre-monorepo). Update this file when major architectural decisions change.
