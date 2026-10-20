# Skydrop — Claude Code Context

This file is loaded at the start of every Claude Code session. Read it carefully — the rules and conventions here are not optional.

---

## What is Skydrop

Skydrop is a **cross-border courier aggregator + light WMS** for Bangladeshi e-commerce sellers shipping to Indian customers.

**Flow:** BD seller ships stock → Skydrop's Indian warehouse receives + holds inventory → end customer in India places order → Skydrop's call center confirms the order by phone (COD culture in India means call confirmation is essential) → warehouse picks/packs → dispatched via Delhivery (primary courier, API-integrated) or manually placed with backup couriers when Delhivery rejects → tracking + RTO handling → delivery.

**Positioning:** We are the operational backbone (warehouse + customer call + courier dispatch + tracking) so BD sellers can sell into India without having Indian operations themselves.

---

## Current hostnames (CON-1 / CON-2 — details in `docs/invariants/consoles.md`)

| App | Host (generated links point here) | Old name, still SERVING (no redirect) |
|---|---|---|
| marketing | `skydrop.global` | `skydrop.online` |
| seller ("Client" in the UI) | `client.skydrop.global` | `app.` |
| reseller ("Member store") | `member.skydrop.global` | `reseller.` |
| associate | `associate.skydrop.global` | `portal.` |
| admin / api / track | `admin.` / `api.` / `track.skydrop.global` | `.online` versions still serve |

UI word ≠ code word on purpose: "Client" is `seller*` in code, "Member store" is `seller_stores.kind = RESELLER`, "Shop" is `kind = CHANNEL`.

---

## Hard rules (every turn)

- **Never remove existing features or code**; only enhance or fix.
- **Money paths** (wallet, ledger, remittance, COD amounts, treasury, freight, P&L): plan first, show the diff, and get a yes before writing. Read `wallet-ledger.md` + `treasury.md` first. A guard that reads then writes must sit inside the writing transaction (guarded `updateMany` / advisory lock), and only a real-database e2e proves it.
- **Push/deploy**: work lands on `main` and is pushed; CI → Deploy is automatic. Watch CI for that exact SHA and fix a red run. Never force-push, reset or rewrite `main`. Never push onto an unverified head (below).
- **Pre-commit gate is `pnpm gate`, run whole** (below). Filtered `--filter` runs are the inner loop only.
- **Production write posture** (courier live writes, which email provider is live) is read from the DATABASE / droplet env, never from a doc.
- `.env*` files are never committed or edited without being asked.

---

## Invariant docs — read the matching one BEFORE touching that area

Everything that used to live below this point was moved **verbatim** into `docs/invariants/` (2026-10-20). Also always relevant: `docs/db-schema.md` (schema source of truth) and `docs/phase-1a-debt.md` (deliberate deferrals). MUST items 1–18 and MUST NOT are below; items 19–25 moved with their topic.

- Read `docs/invariants/scope-stack.md` before touching scope decisions, the stack, repo layout, `apps/workers` or the courier-portal worker.
- Read `docs/invariants/consoles.md` before touching hostnames, console links, sign-in/sign-up pages or user-facing "seller/reseller" copy.
- Read `docs/invariants/database.md` before touching Prisma schema, migrations, hypertables or money/phone/time conventions.
- Read `docs/invariants/orders.md` before touching order lifecycle, god mode, CSV order import or order edits.
- Read `docs/invariants/call-center.md` before touching the call queue or call attempts.
- Read `docs/invariants/warehouse.md` before touching pick, pack, manifest, RTO receive/inspect/finalize.
- Read `docs/invariants/labels-scanning.md` before touching labels, barcodes, pack boxes or scan benches.
- Read `docs/invariants/consignments-bins.md` before touching consignments, goods receipts, transit or bins.
- Read `docs/invariants/catalog-inventory.md` before touching catalog, images, stock, reservations or adjustments.
- Read `docs/invariants/couriers.md` before touching Delhivery, Shiprocket, AWB, dispatch, pickups, NDR or manual placement.
- Read `docs/invariants/courier-costs.md` before touching courier wallet sync, cost netting or invoice checks.
- Read `docs/invariants/tracking.md` before touching webhooks, scan mapping or public tracking.
- Read `docs/invariants/notifications.md` before touching notifications, email providers, broadcasts or outbound webhooks.
- Read `docs/invariants/pricing.md` before touching fees, pricing or FX on fees.
- Read `docs/invariants/wallet-ledger.md` before touching seller wallet, COD credit, withdrawals or accruals.
- Read `docs/invariants/treasury.md` before touching bank book, settlements, remittances, P&L or carry-forward.
- Read `docs/invariants/freight.md` before touching inbound freight bills.
- Read `docs/invariants/reseller-stores.md` before touching reseller stores, store wallet/terms/orders or associates.
- Read `docs/invariants/r-phases.md` before touching settings overrides, courier accounts, tickets, holds or stock units.
- Read `docs/invariants/auth.md` before touching RBAC, guards, API keys, roles or staff impersonation.
- Read `docs/invariants/saga.md` before designing any saga or cross-module multi-step write.
- Read `docs/invariants/ui.md` before touching frontend auth, the proxy, tokens/themes, CSP or shared UI.
- Read `docs/invariants/marketing.md` before touching `apps/marketing`.
- Read `docs/invariants/conventions.md` before adding a module, facade, DTO or test helper.
- Read `docs/invariants/deploy-ci.md` before touching CI, gates, fonts, the route checker or schema-drift traps.
- Read `docs/invariants/ops.md` before touching workers/scaling, capacity or backups.
- Read `docs/invariants/roadmap-history.md` for module status and implementation history.

---

## Token discipline (follow on every task)

1. **Graph first, files second.** For "where/how/what calls X" questions run
   `graphify query "<question>"`, `graphify explain "<Symbol>"` or `graphify path A B`
   before Grep/Read. Read `graphify-out/GRAPH_REPORT.md` only for architecture-wide questions.
2. **Read narrowly.** Use Grep with a glob, then Read with `offset`/`limit`. Never read whole
   generated files, lockfiles, `dist/`, `.next/`, `.turbo/`, `node_modules/`, migrations history or seed dumps.
3. **Scope inner-loop commands to one package**, e.g. `pnpm turbo run typecheck --filter=@skydrop/api --output-logs=errors-only`
   or `pnpm --filter @skydrop/seller test`. Pipe long output through `| tail -n 60`.
   This is the fast inner loop only — the pre-commit gate is still `pnpm gate`, run whole (see Git Workflow).
4. **Edit, don't rewrite.** Make the smallest Edit that works. Don't paste whole files back into chat;
   summarise what changed in ≤5 lines.
5. **Delegate searches.** Broad sweeps (>5 files) go to the Explore subagent; keep only its conclusion.
6. **No narration.** Skip plans for tasks under ~3 steps. No restating the request. No recap at the end.
7. **Session management (always):**
   - When a task is finished, or I switch to an unrelated task, write
     `.claude/HANDOFF.md` yourself (same format as `.claude/commands/handoff.md`,
     max 25 lines) without being asked, then end your reply with exactly:
     `✅ Done — handoff saved. Type /clear for the next task.`
   - If a single task has run long (many large reads/outputs, or roughly
     half the context used), say: `⚠ Context getting large — type
     /compact keep: <one-line focus>` with the focus filled in.
   - At session start, if HANDOFF.md content is in context, continue from it.
     Don't re-read files it already summarises unless needed.
   - If I start an unrelated task without clearing, write the handoff first,
     then tell me to `/clear` before you begin.
8. Only load a skill when the task matches it. Don't open skills "just in case".
9. **UI work in ANY app** (not only apps/marketing) uses the `premium-ui-motion` skill: premium motion, light/dark,
   `prefers-reduced-motion` respected, no layout shift, animate transform/opacity only. Changes to `@skydrop/ui`
   restart every app on deploy — keep them minimal and flag them.
10. After a change, the `skydrop-reviewer` agent (read-only) can check the diff for removed features and money-path risk.

---

## Git Workflow

- Solo dev for now. `main` branch, no feature branches required for trivial work.
- For larger features (anything spanning multiple commits in a logical unit), use a short-lived branch `feat/auth-module` etc. and merge to main via fast-forward.
- Commit messages: conventional commits — `feat(scope):`, `fix(scope):`, `chore(scope):`, `docs(scope):`, `refactor(scope):`, `test(scope):`.
- Multi-line commit messages with rationale for non-trivial changes.
- Push at end of each Claude Code session. Auto-push permitted per `.claude/settings.local.json`.
- NEVER force push to main. NEVER reset main. NEVER rewrite published history.
- Existing tests must stay green at every commit boundary. Update assertions in the same commit that flips behavior.
- Lint stays green at every commit boundary (`--max-warnings 0`). Module 6 surfaced a regression here — a non-null assertion landed in one commit and tripped lint. Always run lint in the verification gates per commit.

---

> MUST items 19–25 live in their topic docs under `docs/invariants/` (see the list above).

### MUST NOT

1. **NEVER** store API credentials in plaintext in the DB. Use `courier_credentials` with AES-256-GCM, key in env.
2. **NEVER** log passwords, API keys, credential plaintext, or full webhook signatures.
3. **NEVER** modify `stock_movements`, `tracking_events`, `call_attempts`, `audit_logs`, or `order_events` after insert.
4. **NEVER** use `db:reset` or `prisma migrate reset` in production-like environments without explicit approval.
5. **NEVER** install dependencies the user didn't approve. Ask first.
6. **NEVER** commit `.env` files (`.env.example` only).
7. **NEVER** push to a non-`main` remote branch without confirming the user wants it.
8. **NEVER** delete files without verifying nothing depends on them.
9. **NEVER** implement Phase 1B/2 features unless explicitly asked.
10. **NEVER** clear `orders.hasAdminOverride` once set. The flag is the audit trail's hook for "this order's history was touched by god mode."
11. **NEVER** persist the access token to `localStorage` / `sessionStorage` / IndexedDB / a non-`HttpOnly` cookie (FE-1). In-memory `AccessTokenStore` only. XSS-exfiltratable surfaces are forbidden.
12. **NEVER** make a cross-origin browser→API call from a frontend (FE-3). The Next.js route-handler proxy is the sole `/api/*` bridge.
13. **NEVER** call `RefreshTokenService.rotate()` (or `POST /auth/{kind}/refresh`) from a server component / SSR path (FE-4). Use `validateByPlaintext` — read-only, no rotation, no family-burn.
14. **NEVER** hardcode a hex color in a frontend component when the token system covers the slot (FE-6). If a semantic color is missing, add a kind to `@skydrop/ui/status` — don't bypass it.
15. **NEVER** pre-empt a server guardrail with a client-side mirror of its policy (FE-2). The UI is reading material; the server is law. Surface the server's `[CODE] message` verbatim.
16. **NEVER** post a `RECEIVING` movement for a consignment leg that carries `dispatchedAt` (CNS-4). The goods already exist in the destination's TRANSIT bin; a second copy would be the sellable one.
17. **NEVER** hand-set `consignments.status`. `ConsignmentStatusService.recompute` derives it from the legs and from where the stock physically sits (CNS-6).
18. **NEVER** add a blocking gate that withholds stock over a count variance (CNS-3). Counts move in both directions, nobody acts on the difference, and the goods carry on.

---

### MUST

1. Read `docs/db-schema.md` before any code touching the database.
2. Read this `CLAUDE.md` at session start (you're doing it now).
3. Read `docs/phase-1a-debt.md` to know what's intentionally deferred.
4. Run `pnpm prisma format && pnpm prisma validate` after schema edits.
5. Run `pnpm tsc --noEmit` before committing.
6. Write tests for service-layer rules (state machines, transactions, idempotency).
7. Use the `prisma` singleton from `@skydrop/db`, never `new PrismaClient()`.
8. Wrap multi-write operations in `prisma.$transaction` — except where saga pattern applies (see "Cross-module integration with M5 stock services" above).
9. Use BullMQ for async work (notifications, webhook delivery, cleanup jobs). No background work in HTTP request handlers.
10. Snapshot data when immutability matters (order recipient address, order item SKU info, shipment dest address).
11. Add new enums to `packages/db/src/enums.ts` after adding them to `schema.prisma`.
12. When adding tables with FKs to existing entities, add a `reset<Module>State()` helper and chain it into the central e2e reset before the parent reset.
13. Use `CatalogReadService` for cross-module variant **reads**; never query `product_variants` directly from outside the catalog modules. *Clarification (Module 5): this governs cross-module READS so inheritance precedence stays centralized. A column owned by another domain that lives on a catalog table for storage convenience — e.g., inventory's `product_variants.low_stock_threshold` — may be written by the owning domain directly, with an explicit code comment; its reads still go via `CatalogReadService` as a raw passthrough.*
14. Use `makeTestEnv()` in test fixtures instead of inline literal env objects.
15. All stock writes go through `StockMutationService` (INV-1); never write `stock_movements` or `stock_levels.qtyOnHand` elsewhere. Honor INV-2 (cache reads-only via method-name split), INV-3 (use `StockAvailabilityService.compute()` for the canonical scalar), INV-4 (`qtyReserved` = phase-2 only). For cross-module stock needs, import only the three services exported by `inventory-stock`.
16. All cross-module order writes go through `OrderWriteService.transitionStatus()` (ORD-3). Never UPDATE `orders.status` directly from outside the order module. God mode (ORD-2) is the single sanctioned bypass and only via `OrderAdminOverrideService.forceMutate()` with full guardrails. For M5 integration, use the saga pattern (pre-tx reserve, compensating release on tx-fail, post-commit idempotent for release/fulfill).
17. Honor CC-1 through CC-7 (Module 7). The ONLY cross-module call-queue surface is `CallQueueService` (from the standalone `call-queue` module); never query `call_queue_entries` / `call_attempts` from another domain. Outcome→transition mapping lives ONLY in `CallOutcomeMappingService` (CC-2). The order transition is POST-COMMIT of the attempt and its failure never rolls back the attempt (CC-3). When a cross-cutting primitive would create a module cycle, apply the R3 extraction (own dependency-free module), not `forwardRef`.
18. Honor WMS-1 through WMS-9 (Module 8). The ONLY cross-module shipment-provision surface is `ShipmentProvisionService` (from the standalone `shipment-provision` R3 module); never query `shipments` / `manifests` directly from another domain. Warehouse direct stock writes go through `StockMutationService` (INV-1) via `InventorySharedModule` import (same shape as `inventory-adjustment`) — NEVER write `stock_movements` / `stock_levels.qtyOnHand` from a warehouse module directly. The pick-allocation source-of-truth is the phase-2 `stock_reservations`; `shipment_items.picked*` / `shipment_items.rto*` are operational hints (WMS-9). For sagas where a cross-module service owns its own tx, order steps for visible-vs-silent failure recovery (see "Saga: visible-vs-silent failure ordering" above); apply the R3 snapshot-DTO refinement when a primitive needs upstream data.

## Gate rules

**`pnpm gate` is the pre-commit gate. Run it whole; never a subset (2026-08-06).**
It is `gate:clean` (delete every `.tsbuildinfo` — see the stale-cache trap below)
then typecheck → lint → `format:check` → the full unit suite, which is exactly
what CI's `static` and `unit` jobs run. **Do not substitute a filtered test run
for it.** Running `jest test/unit/delhivery test/unit/courier` after a change
that touched shared code shipped two failing tests in `awb-generation.service.spec.ts`
on 2026-08-05 — the file matched neither prefix, so the gate reported green on
a suite it had never executed. The failure mode is not "I picked the wrong
filter", it is that a filter exists at all: the set of affected files is
exactly what you cannot know in advance, which is the whole reason the change
needed a gate. A subset run is only ever a fast inner loop, never the thing you
commit on.

**Two suites must never be filtered out of a local run**, whatever the change
looked like: `app-module-boots.spec.ts` (one test, a few seconds, and the only
thing that proves the app starts — the cheapest value-per-second in the
repository and the easiest to lose to a path filter) and any `*-threading` or
structural spec that reads sources rather than behaviour, because those exist
precisely to catch what a behavioural test cannot see.

**Do not push onto an unverified head (2026-08-06).** If a previous commit's
CI has not gone green, WAIT — or push the fix for it first. A commit stacked on
an unverified head inherits whatever is broken underneath it, so its run goes
red for a reason that has nothing to do with the change, and the result teaches
nothing while costing a full CI cycle. It also muddies the record: three red
runs where only one had a real defect makes the history read as instability
rather than as one bug and two self-inflicted repeats. This happened on
2026-08-06 — a docs-only commit went out on top of an unverified fix and failed
on a test failure that was already known.

## Package management
- This is a pnpm + Turborepo workspace. NEVER use npm or yarn.
- Install deps into specific apps: pnpm --filter ./apps/<app> add <pkg>
- The landing page is apps/marketing. Dev: pnpm --filter ./apps/marketing dev

## graphify

This project has a knowledge graph at graphify-out/ with god nodes, community structure, and cross-file relationships.

Rules:
- When graphify-out/graph.json exists, run `graphify query "<question>"` before your first grep, search or source-file read for a codebase question, and put this rule in every subagent prompt that explores code. Read raw files only for lines the graph or an earlier read already located. Use `graphify path "<A>" "<B>"` for relationships and `graphify explain "<concept>"` for focused concepts. These return a scoped subgraph, usually much smaller than GRAPH_REPORT.md or raw grep output.
- If graphify-out/wiki/index.md exists, use it for broad navigation instead of raw source browsing.
- Read graphify-out/GRAPH_REPORT.md only for broad architecture review or when query/path/explain do not surface enough context.
- After modifying code, run `graphify update .` to keep the graph current (AST-only, no API cost).
- A committed graphify-out/graph.json is rewritten whole on every build, so a large diff to it in a pull request is expected. Do not flag it as churn or suggest skipping the graph rebuild or its hooks.
