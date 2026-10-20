# Phase 1A scope, stack, repo structure, workers

> Moved verbatim from `CLAUDE.md` on 2026-10-20 (split into `docs/invariants/`). The `<!-- from CLAUDE.md … -->` markers record where each block sat; the text below them is unchanged.

<!-- from CLAUDE.md lines 40-141 · Phase 1A — Scope -->
## Phase 1A — Scope

Phase 1A covers **everything except billing/wallet/remittance**. Specifically:

**IN SCOPE (Phase 1A):**
- Seller onboarding (invite-only)
- Product/SKU catalog with products, variants, images
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
| Email | **TWO providers** — Resend (credential mail) + Amazon SES `ap-south-1` (everything else), chosen by `EmailProviderRouter`; templates in DB rendered with Nunjucks. See NOTIF-24. |
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
│   ├── marketing/         # ✅ skydrop.global — public marketing site (static export)
│   ├── seller/            # ✅ client.skydrop.global — seller dashboard (was app.)
│   ├── admin/             # ✅ admin.skydrop.global — internal staff
│   ├── track/             # ✅ track.skydrop.global — public tracking page
│   ├── reseller/          # ✅ member.skydrop.global — reseller store portal (was reseller.; RS-2, port 3005)
│   ├── associate/         # ✅ associate.skydrop.global — a store's own sales people (was portal.; ASSOC-1, port 3007)
│   ├── api/               # ✅ api.skydrop.global — NestJS REST API
│   └── workers/           # ⚠️ BUILT BUT NOT DEPLOYED — see the note below
├── packages/
│   ├── db/                # ✅ Prisma + types (@skydrop/db)
│   ├── ui/                # ✅ design tokens + shared React components (@skydrop/ui)
│   ├── config/            # ✅ security-headers.mjs + csp-middleware.mjs (no src/, .mjs only)
│   ├── types/             # placeholder (README only)
│   ├── i18n/              # placeholder (README only)
│   └── utils/             # placeholder (README only)
├── docker/                # docker-compose.yml for local Postgres + Redis
├── docs/
│   ├── infrastructure.md  # provisioning + ops reference
│   ├── db-schema.md       # canonical schema spec (the source of truth)
│   ├── phase-1a-debt.md   # explicit Phase 1A deferrals tracked here
│   ├── delhivery-integration.md        # verified wire contract (2026-07-27)
│   ├── shiprocket-integration.md       # access, account state, what blocks go-live (2026-09-08)
│   ├── courier-parity.md               # Delhivery vs Shiprocket, capability by capability (2026-09-09)
│   ├── email-dns.md                    # Resend sends, Cloudflare receives, DMARC at quarantine (2026-09-09)
│   ├── delhivery-go-live-test.md       # the first-real-write procedure (NOT yet run)
│   └── skydrop-courier-escalation-brief.md  # courier escalation spec + verification findings
└── CLAUDE.md              # this file
```


<!-- from CLAUDE.md lines 166-198 · Repo Structure -->
**`apps/workers` — the capability exists, the process does not run (verified 2026-08-05).**
`apps/api/src/workers-main.ts` bootstraps the SAME `AppModule` with no HTTP
listener, and `@skydrop/workers` starts it from `apps/api/dist/workers-main.js`
(no second build). pm2 on the droplet runs FIVE processes (corrected
2026-09-09 — this said four for months): `skydrop-api`, `skydrop-admin`,
`skydrop-seller`, `skydrop-track` and **`skydrop-portal`** (plus
`skydrop-reseller` on 3005 — RS-12, 2026-09-14 — and `skydrop-associate` on 3007, ASSOC-1, 2026-10-08). `@skydrop/workers`
is still not among them, so **all 17 BullMQ workers run in-process inside
`skydrop-api`** under SCALE-1's `WORKERS_ENABLED` (default true).

**`skydrop-portal` is a SEPARATE root module, and that is load-bearing.**
`portal-worker-main.ts` boots `PortalWorkerRootModule` — deliberately NOT
`AppModule` — because it owns a long-lived Chromium holding a decrypted courier
login, which must not sit in the process serving customer HTTP. So
**`CourierPortalModule` is unreachable from `AppModule`**
(`portal-worker-isolation.spec.ts` enforces it), and the consequence bites in a
way nothing catches: **a controller placed in `CourierPortalModule` is
registered by nobody and answers 404.** `app-module-boots.spec.ts` compiles
`AppModule`, so it says nothing about that graph, and CI and Deploy both go
green. It was found by calling the endpoint on production. **An API surface over
anything the portal owns goes in an API-side module and reaches the worker
through its BullMQ queue** — `courier-cost-sync` is the worked example, and it
restates the queue/job names rather than importing them, with
`wallet-sync-queue-names.spec.ts` failing on drift (drift there has no symptom:
the enqueue succeeds into a queue nobody listens to). This doc called the package a placeholder for
months; it is not, and the distinction matters: **the "background work runs in a
process that serves no HTTP" boundary is available but NOT currently in effect.**
Any design that relies on that separation (e.g. holding a courier credential only
in a non-HTTP process) must first split the process — deploy `@skydrop/workers`
and set `WORKERS_ENABLED=false` on the API — not merely assume it.

---
