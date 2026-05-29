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

**Canonical reference:** `docs/db-schema.md`. When the schema and this doc diverge, the doc wins; update Prisma to match.

**Migrations applied:** Through Module 9 — M7 call-center reconcile + reject terminals + call-queue partial unique index; M8 warehouse-ops schema additions; M9 courier integration schema (`supersede_reason` enum, `manifest_status` += confirmed/dispatched/failed, shipment supersede columns, manifest awb-job/handoff columns).

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

**Order rules (ORD-1 through ORD-10 — NON-NEGOTIABLE):**

1. **ORD-1: Lifecycle state machine.** `OrderStateMachineService` — 28-status declarative transition matrix (Module 7 added `REJECTED_BY_CUSTOMER` + `REJECTED_NDR` reject terminals); no any→any. **Matrix-declared self-loops are valid event-writing transitions** (Module 7: `CALL_NO_RESPONSE→CALL_NO_RESPONSE`, `CALL_RESCHEDULED→CALL_RESCHEDULED` — "same state, a new attempt was logged"); `transitionStatus` lets `from===to` through ONLY when the matrix declares it, else 409 NOOP_TRANSITION. Critical property: pre-confirmation cancels carry NO stock release (nothing was reserved yet — see ORD-10).

2. **ORD-2: God mode is the ONE sanctioned bypass.** `OrderAdminOverrideService.forceMutate()` only. Guardrails: reason ≥30 chars, `acknowledgeDataIntegrityRisk` literal `true`, ≥1 of `fieldChanges`/`targetStatus`; DB + event + audit in one tx; `hasAdminOverride` set-once-NEVER-cleared; audit severity CRITICAL. Opts OUT of saga compensation (reserve attempted-not-blocking on →CONFIRMED; away-from-CONFIRMED leaves reservations — cleanup via `release-reservations` endpoint).

3. **ORD-3: Status changes via `OrderWriteService.transitionStatus()`** — the sole cross-module WRITE boundary. Order row + events + audit are one tx. The stock side-effect is a **SAGA** (M5 INV-1/INV-6 owns its own tx, takes no tx param): RESERVE pre-tx (fail→OUT_OF_STOCK / 409; tx-fail→compensating release); RELEASE/FULFILL post-commit idempotent (mirrors INV-5).

4. **ORD-4: `OrderEventWriterService` is the only writer of `order_events`**, append-only (no update/delete path by construction).

5. **ORD-5: SOFT recipient validation** — format checks (PIN, E.164 phone) + `ops.allowed_indian_states` membership only; no PIN↔state cross-check (deferred).

6. **ORD-6: Immutable snapshot.** Recipient block + per-line SKU info snapshotted at order create, never re-linked. Cross-module consumers read the order's snapshot via `OrderReadService`, never re-resolve from the live catalog.

7. **ORD-7: Per-seller customer identity** — `@@unique(sellerId, phoneE164)`. Phone immutable once set (no mutation path by construction). Cross-seller customer dedup deferred (Phase 1A privacy choice).

8. **ORD-8: Order numbers** via per-year Postgres SEQUENCE under a txn-scoped advisory lock, allocated INSIDE the create tx. Format: `SD-YYYY-NN-XXXXXX`.

9. **ORD-9: CSV import is state-aware idempotent** by `(sellerId, externalRef→sellerOrderRef)`: new → create PENDING_CONFIRMATION; DRAFT/PENDING_CONFIRMATION → PATCH; CONFIRMED+ → error row. CSV is submission, not drafting. One row = one order, single line (Phase 1A; multi-line deferred to Phase 2).

10. **ORD-10: Reservation is LATE.** NO stock reserved at order create (no availability check at create — M7 catches at confirm). Reservation is created only on entry to CONFIRMED via the M5 saga pattern in ORD-3.

**Call Center rules (Module 7 — CC-1 through CC-7, NON-NEGOTIABLE):**

1. **CC-1: `call_attempts` is APPEND-ONLY.** Each row is a historical fact; no UPDATE/DELETE path by construction (matches ORD-4 / `order_events` / `stock_movements`). Added to MUST NOT list.

2. **CC-2: Outcome→transition mapping is centralized in `CallOutcomeMappingService`.** Single source of truth (pure logic, no Prisma, mirrors `OrderStateMachineService`). The 9-outcome table + the at-cap NDR reroute live ONLY here; never duplicated in controllers/other services. The 6/9 cap-counting set is derived from this service so it can't drift.

3. **CC-3: The order transition is POST-COMMIT of the attempt write.** The attempt is the source of truth: it persists regardless of what the transition does. A `transitionStatus` failure is logged + audited HIGH (`call_attempt.transition_failed`) and swallowed — NEVER thrown upstream, NEVER rolls back the attempt. The M5 reserve saga may itself land CONFIRMED→OUT_OF_STOCK; that is M5's call and surfaces in `finalOrderStatus`.

4. **CC-4: Attempt write + queue-entry COMPLETED are one tx.** Atomic: attempt inserted AND entry closed together, or neither. `priorAttemptCount` is counted BEFORE the insert (filtered to the 6 counting outcomes) so the resolver's +1 is exact.

5. **CC-5: Attempt counting respects the 6/9 list.** CONFIRMED, CUSTOMER_DECLINED, WRONG_NUMBER, NO_ANSWER, BUSY, VOICEMAIL_LEFT count; CALLBACK_REQUESTED, TECHNICAL_FAILURE, LANGUAGE_BARRIER do NOT. At cap, a CALL_NO_RESPONSE-bound counting outcome reroutes to terminal REJECTED_NDR with no re-queue. Effective cap = `seller.callMaxAttemptsBeforeNdrOverride ?? ops.call_max_attempts_before_ndr ?? 3`.

6. **CC-6: Enqueue on entry to PENDING_CONFIRMATION, dequeue on exit — both idempotent, both POST-COMMIT, best-effort.** Enqueue at `OrderService.create` (PENDING_CONFIRMATION initialStatus — covers the CSV worker) + `OrderService.submit` + `OrderWriteService.transitionStatus` (result.status===PENDING_CONFIRMATION). Dequeue at `transitionStatus` on any PENDING_CONFIRMATION exit. **Dual-path idempotency:** a CallAttemptService flow already COMPLETED the entry in its own tx, so the post-commit transition's dequeue is a safe no-op (`{dequeued:0}`); a direct admin/god-mode transition does the real close. enqueue no-ops on an existing OPEN entry (partial-unique). A best-effort failure never fails the order write — an admin re-enqueue / out-of-band reconciler recovers (mirrors INV-5 / the saga post-commit discipline).

7. **CC-7: Assignment expiration is purely time-based + idempotent.** A delayed BullMQ job scheduled at pull time fires `AssignmentExpirationService.expire()`; a guarded conditional `updateMany` on `(status=ASSIGNED, that exact assignedAt)` reverts ASSIGNED→PENDING (clears agent, `availableAt` untouched → original FIFO position kept). Already-COMPLETED/EXPIRED, already-PENDING, or re-ASSIGNED-with-newer-assignedAt all no-op, so retries / duplicate deliveries / an old timer racing a fresh re-pull can never double-expire or steal a new assignment. The `expire()` method is public — it doubles as the manual trigger. Custom BullMQ jobId must be colon-free (Redis key separator) — encode the timestamp as epoch-ms.

**Module 7 architecture (R3 + facade):**
- The queue PRIMITIVE lives in a standalone `call-queue` module (`CallQueueService` — `enqueueOrder` / `enqueueAgain` / `dequeueOrder`; NO Order dependency). Imported by BOTH `order` and `call-center`; it imports neither. This **R3 split** removes the would-be `order ↔ call-center` circular module dependency WITHOUT `forwardRef` (same spirit as inventory-shared/inventory-stock and order-core/order). **When M8/M9 face the same "two domains need a shared cross-cutting primitive" shape, extract the primitive into its own dependency-free module rather than reaching for `forwardRef`.**
- `pullNext` lives in `call-center`'s `CallAssignmentService` (NOT the queue primitive) because it enriches via `OrderReadService`. FIFO via `ORDER BY available_at ASC, created_at ASC` + `FOR UPDATE SKIP LOCKED LIMIT 1` inside the assigning tx (Postgres-native; two agents clicking "next" can never get the same row).
- Cross-module export surface: `CallQueueService` (from `call-queue`) only. `call-center` exports NOTHING externally (CallOutcomeMappingService is exported intra-module only); CallAttemptService / AgentSettingsService / Admin* services are internal.

**Warehouse Operations rules (Module 8 — WMS-1 through WMS-9, NON-NEGOTIABLE):**

1. **WMS-1: Pick-queue semantics.** Order `CONFIRMED` = "in pick queue, not started"; `PENDING_PICK` = "pick in progress." The `CONFIRMED → PENDING_PICK` transition fires on the picker's FIRST START (`PickExecutionService.start`), not on `pullNext`. Pick expiry (WMS-5) leaves the order in `PENDING_PICK` and only clears `shipments.pickStartedAt`, re-pickable via the `pickStartedAt IS NULL` filter — no `PENDING_PICK → CONFIRMED` bounce. WMS-4's `PENDING_PICK → PENDING_MANUAL_PLACEMENT` is the shortfall escalation (no side-effects; M5 conservation keeps residual phase-1).

2. **WMS-2: `pullNext` concurrency.** `PickQueueService.pullNext` and `PackQueueService.pullNext` both use `FOR UPDATE OF s SKIP LOCKED LIMIT 1` inside the locking tx — `OF s` restricts the row lock to `shipments` ONLY, so the joined `orders` row stays read-only and a concurrent `OrderWriteService.transitionStatus` (which locks the order row) can never deadlock against a pull. Eligibility is the AUTHORITATIVE order status joined into the locking SELECT (WMS-1/WMS-9): pick = `s.status='created' AND s.pick_started_at IS NULL AND o.status IN ('confirmed','pending_pick')`; pack = `s.status='created' AND s.pack_completed_at IS NULL AND o.status='picked'`. The order-status predicate is a HARD filter, not a proxy — `ShipmentProvisionService.voidForOrder` is best-effort, so a lagged void must still be excluded here.

3. **WMS-3: Pick-allocation outer retry over M5.** `PickAllocationService.allocateForPick` wraps `StockPickAllocationService.allocateAndPopulate` with an OUTER retry/backoff (`ops.pick_allocation_retry_max` seeded 3, `ops.pick_allocation_retry_backoff_ms` seeded `[100,250,500]`). M5's own version-CAS inner retry (INV-6) handles transient conflicts; this layer turns the rare *terminal* `PICK_ALLOCATION_CONFLICT` into a non-terminal `PICK_ALLOCATION_RETRY_EXHAUSTED` so commit-6 can fail-route to PENDING_MANUAL_PLACEMENT rather than 500. Only the typed 409 is retryable; `NotFound` / `RESERVATION_NOT_ACTIVE` / `strategy: 'NONE'` (stock not arrived) pass through.

4. **WMS-4: Pick shortfall fail-routing.** When `PickExecutionService.start` cannot fully allocate (any reservation returns shortfall / strategy NONE/PARTIAL / RETRY_EXHAUSTED, or the order has zero ACTIVE reservations — a data anomaly), the saga transitions `PENDING_PICK → PENDING_MANUAL_PLACEMENT` (the commit-1 matrix edge, empty side-effects). M5 conservation keeps the residual phase-1 reservation; supervisor resolves. NEVER 500.

5. **WMS-5: Pick-task expiration.** Time-based idempotent CAS (mirrors CC-7). A delayed BullMQ job carries the `pickStartedAt` it was scheduled for; a guarded `updateMany` on `(id, status=CREATED, pickStartedAt=<that exact value>, pickCompletedAt IS NULL)` reverts the claim (clears `pickStartedAt`/`pickStartedByStaffId`/`pickExpiresAt`). Vanished / completed / re-pulled / lost-the-race all no-op, so BullMQ retries, duplicate deliveries, and an old timer racing a fresh re-pull can never double-expire. POST-CAS it calls `StockPickAllocationService.releaseAllocation` per ACTIVE reservation (collapses the phase-2 split back to a single conserved phase-1 row, INV-4) — best-effort, idempotent; failure swallowed (next pull's `allocateAndPopulate` tolerates residual phase-2 idempotently). `expire()` is public — doubles as the supervisor manual trigger. Custom BullMQ jobId must be colon-free (epoch-ms encoding).

6. **WMS-6: Manifest close = supervisor saga + M9 AWB stub.** `ManifestService.close` is `WAREHOUSE_SUPERVISOR`/`SUPER_ADMIN` only (controller-gated via `requireStaffRoles`). The CLOSURE TX (manifest `updateMany` guarded on `(id, status=DRAFT)` → CLOSED + closedAt + closedByStaffId + audit MEDIUM) commits atomically; POST-COMMIT per-shipment `PACKED → PENDING_DISPATCH` transitions are each their own `transitionStatus` tx (matrix edge has empty side-effects, verified) — failures collected into `result.failures` and the loop continues (manifest correctly CLOSED is the supervisor's intent; failures surface for investigation, do NOT undo closure). The Module-9 AWB enqueue is a STUB: audit HIGH `manifest.awb_enqueue_stub` with `metadata.{manifestId, shipmentIds, transitionedCount, failureCount, moduleStubbed:'M9'}`. `ManifestStatus` is intentionally `DRAFT`/`CLOSED` only for M8; M9 extends with `AWB_PENDING`/`CONFIRMED`/`FAILED`. Idempotent on already-CLOSED.

7. **WMS-7: Manifest find-or-create + move (DRAFT↔DRAFT).** `PackService.complete` auto-attaches the packed shipment to a DRAFT manifest via `ManifestService.attachShipment` (POST-COMMIT, best-effort, idempotent) — find-or-create one DRAFT per `(courierCode, originWarehouseId)`. Concurrency: per-pair `pg_advisory_xact_lock` (namespace `0x04d47`, JS FNV-1a 32-bit key on `<courier>|<warehouse>`) serializes concurrent attaches for the same pair so parallel DRAFTs never appear; distinct pairs uncontended. Numbering format `MF-YYYY-MM-XXXXXX` (mirrors `ShipmentNumberingService` per-year sequence + advisory lock 0x04d46 'MF'). `ManifestService.moveShipment` reassigns a packed shipment from one DRAFT to another (both DRAFT, same courier + warehouse — `SOURCE_MANIFEST_CLOSED` / `TARGET_MANIFEST_NOT_DRAFT` / `COURIER_MISMATCH` / `WAREHOUSE_MISMATCH` guards). Phase-1A: single courier → single DRAFT typically → moveShipment is dormant; reachable when M9 multi-courier lands.

8. **WMS-8: RTO finalize = release-based two-gate saga (revised).** Under the codebase's current "qtyOnHand only changes when goods truly leave permanently" semantics (Model B — see phase-1a-debt bug-1 HIGH entry), `RtoDispositionService.finalize` is: **RESTOCK** = `StockReservationService.release()` per ACTIVE reservation (clamped `qtyReserved` decrement, marks RELEASED), **NO** `RETURN_RESTOCK` movement (qtyOnHand was never decremented; nothing to add back). **WRITE_OFF** = release per reservation + `mutation.apply(tx, ADJUSTMENT_DECREASE, -qty, reasonCode: <mapped from rtoCondition>)` (DAMAGED→DAMAGED_IN_WAREHOUSE, MISSING→LOST, GOOD/null→OTHER — debt entry tracks a dedicated RTO_* value). Order goes to `RTO_RESTOCKED` regardless of restock/write-off mix. **Two-gate idempotency:** Gate 1 = `order.status===RTO_RESTOCKED → alreadyFinalized`; Gate 2 = `stockMovement.findFirst({shipmentId, type:ADJUSTMENT_DECREASE})` skips re-apply (WRITE_OFF only; `stock_movements` has no native dedup key — the explicit existence query IS the gate). Reservation release is natively idempotent (`alreadyInactive`). **Saga ordering: releases first, WRITE_OFF movements second, transition last** — visible-vs-silent failure ordering (see "Saga: visible-vs-silent failure ordering" below). The original commit-15 RETURN_RESTOCK design INFLATED stock + leaked reservations — caught by the full-lifecycle conservation e2e, corrected in the follow-on fix; the conservation e2e remains as a permanent regression guard.

9. **WMS-9: Order status is the authoritative lifecycle gate.** `shipments.pickStartedAt/pickStartedByStaffId/pickExpiresAt/pickCompletedAt/packCompletedAt/packedByStaffId` + `shipment_items.rto*` + `shipment_items.pickedBinId/pickedBatchId` are all OPERATIONAL who/when columns + hints — NOT cross-domain authority. The authoritative pick-allocation source-of-truth is the phase-2 `stock_reservations` (INV-4); the authoritative pick context is the order's lifecycle status. `complete` validates fully-allocated via the order-status gate (a shortfall already escalated at start, so reaching `complete` in PENDING_PICK ⇒ allocation succeeded) + "every shipment_item recorded" — NOT against the hint columns. Cross-module readers never query `shipments.*` operational columns to make decisions; they go through `OrderReadService` / `OrderWriteService.transitionStatus` (ORD-3 / MUST #16).

**Module 8 architecture (R3 + facade):**
- The shipment-provision PRIMITIVE lives in a standalone `shipment-provision` module (`ShipmentProvisionService.provisionFromSnapshot` / `voidForOrder`, `ShipmentNumberingService`; NO Order dependency). Imported by `order` (commit 16 CC-6 dual-path) AND the warehouse modules; it imports neither. The fourth successful **R3 split** after M4/M5/M7. **R3 snapshot-DTO refinement:** shared primitives are DEPENDENCY-FREE — if the operation needs upstream data, the CALLER marshals it as a DTO rather than the primitive resolving via service calls. M7's `call-queue` takes `orderId` (the queue is keyed on it; the primitive needs no Order data); M8's `shipment-provision` takes a full `ProvisionShipmentInput` DTO (shipment construction needs the recipient block + item snapshot, which the caller builds from the order it already loaded — `OrderWriteService.transitionStatus` does exactly this on entry to CONFIRMED, leveraging the snapshot already inlined in its order load).
- Module split: `warehouse-pick` (Picker/AdminPick controllers + PickQueueService.pullNext + PickAllocationService + PickExecutionService.{start,recordItem,complete} + PickExpiration{Service,Queue,Worker}); `warehouse-pack` (PackerController + PackQueueService.pullNext + PackService.complete with WMS-7 post-commit auto-attach); `warehouse-manifest` (AdminManifestController + ManifestService.{attachShipment, moveShipment, close, listManifests, getById} + ManifestNumberingService); `warehouse-rto` (WarehouseRtoController + RtoReceiptService + RtoInspectionService + RtoDispositionService). All four are LEAF consumers — nothing imports them.
- Cross-module export surface: `ShipmentProvisionService` (from `shipment-provision`) only — the R3 primitive `order` and warehouse-* call into. The warehouse modules export NOTHING externally.
- Pack queue model (locked decision): VIRTUAL FIFO query, no `pack_queue_entries` table — entry to `PICKED` makes the shipment eligible by construction via the pullNext filter. The "enqueue on PICKED" hook in `OrderWriteService.transitionStatus` is an INLINE post-commit audit (`pack_queue.eligible`, LOW) — the observability extension point for future BullMQ/WebSocket packer-notification (then replace with the real enqueue; mirrors the CC-6 enqueueForCall shape).
- Pack claim model (locked decision): NO persistent claim (schema intentionally added no `packStartedAt`/`packExpiresAt`). `pullNext` is informational; `complete` is the race-resolution point via atomic guard on `(status=CREATED, pack_completed_at IS NULL)` — concurrent winner persists; loser sees 409 `PACK_NOT_AVAILABLE` and re-pulls. Phase-1A volume makes the race rare; revisit if pack volume scales.

**Courier Integration rules (Module 9 — CUR-1 through CUR-9, NON-NEGOTIABLE):**

1. **CUR-1: Courier credentials are decrypt-with-audit.** `CourierCredentialService` decrypts `courier_credentials` (AES-256-GCM); the key is NEVER in the DB — env `COURIER_CREDENTIALS_KEY_<version>`. Every decrypt writes an `audit_logs` row BEFORE returning plaintext; plaintext is never logged, never serialized to a response, never cached longer than 5 min.

2. **CUR-2: AWB generation is a per-manifest BullMQ saga with per-shipment failure isolation.** `ManifestService.close` (→ CLOSED) enqueues `AwbGenerationQueue`; `AwbGenerationJobService.processManifest` iterates the manifest's CREATED shipments — one shipment's failure NEVER aborts the others (same fan-out discipline as M8 `ManifestService.close`). ≥1 AWB generated → manifest CONFIRMED; zero → FAILED. Idempotent (already-CONFIRMED/DISPATCHED/FAILED → no-op; superseded shipments self-detach so a retry never re-supersedes); `processManifest` is public — it doubles as the manual ops trigger.

3. **CUR-3: qtyOnHand decrements EXACTLY ONCE, at DISPATCH (Model A — the bug-1 resolution).** The `PENDING_DISPATCH → DISPATCHED` and `PENDING_MANUAL_PLACEMENT → DISPATCHED` matrix edges carry the `DISPATCH_STOCK` side-effect: per phase-2 reservation, `StockMutationService` issues a `DISPATCH` movement (`−qtyReserved` — the ONE normal-lifecycle physical decrement) AND `StockReservationService.fulfill()` consumes the reservation. DELIVERED is STOCK-NEUTRAL; M10 tracking webhooks never touch stock. `RtoDispositionService.finalize()` is Model A (RESTOCK → `RETURN_RESTOCK +qty` re-add; WRITE_OFF → no movement — the dispatch decrement stands). The DISPATCH saga is shipment-grained idempotent (gate: a prior `DISPATCH` movement for the live shipment) — visible-vs-silent ordering: movements pre-tx, transition tx, fulfill post-commit.

4. **CUR-4: Dispatch handoff is a supervisor per-manifest fan-out.** `DispatchHandoffService.confirmHandoff` (`WAREHOUSE_SUPERVISOR`/`SUPER_ADMIN`, controller-gated) drives every AWB-ready shipment `PENDING_DISPATCH → DISPATCHED`, marks the shipment `HANDED_TO_COURIER`, flips the manifest `CONFIRMED → DISPATCHED`. Per-shipment failure isolation; per-shipment transitions FIRST, the manifest flip LAST (reaching DISPATCHED means every shipment was processed; a mid-run crash leaves CONFIRMED for a retry-convergent re-run). Idempotent on already-DISPATCHED.

5. **CUR-5: Serviceability is REACTIVE.** No proactive pre-dispatch serviceability call gates the order flow — a Delhivery AWB rejection (non-serviceable / courier failure) IS the signal: the AWB job routes the order to `PENDING_MANUAL_PLACEMENT` via auto-supersede (CUR-7). `DelhiveryServiceabilityService` exists but is NOT on the critical path (proactive serviceability deferred — phase-1a-debt).

6. **CUR-6: AWB labels are persisted to OUR Spaces.** On AWB success the label is fetched (`DelhiveryLabelService`) and uploaded to our DigitalOcean Spaces bucket; an `awb_labels` row (versioned, `isCurrent`) records it. A re-issue (`AWB_REISSUED`) demotes the prior current label. **Real-mode ordering bug** — label upload currently precedes the awbNumber persist; a label-upload failure after Delhivery issued a real AWB leaks an unpersisted AWB → CUR-9 gate misses → retry double-generates. Inert in stub mode; the real-mode fix (persist awbNumber first, label as a retryable follow-on) is tracked in phase-1a-debt.

7. **CUR-7: Supersede chain — a failed AWB RETIRES the shipment, never deletes.** `AwbSupersedeService` sets the OLD shipment `FAILED_AT_CREATION` + `supersededAt`/`supersedeReason`, clears its `manifestId`, and creates a REPLACEMENT (status `CREATED`, `supersedesShipmentId` = OLD — the NEW→OLD FK; copies the dest snapshot + physical + pick/pack operational state + line snapshots; NO AWB / NO manifest). Idempotent (already-superseded → returns the existing replacement). Order routing to `PENDING_MANUAL_PLACEMENT` is the CALLER's (AWB job's) job — supersede is a shipment-level mechanism only (WMS-9 / ORD-3 separation).

8. **CUR-8: Manual placement.** A `MANUAL_PLACEMENT_ADMIN`/`SUPER_ADMIN` records a manually-arranged courier AWB on a `PENDING_MANUAL_PLACEMENT` shipment (`ManualPlacementService.placeAwb` — `courierCode='manual'`, `isManualCourier=true`) and the order dispatches directly (`PENDING_MANUAL_PLACEMENT → DISPATCHED`, CUR-3 `DISPATCH_STOCK`). CONSERVATION-GUARDED: every ACTIVE reservation must be phase-2 — a pick-shortfall `PENDING_MANUAL_PLACEMENT` order (residual phase-1) is rejected and must re-pick via `→ PENDING_PICK` first. Saga: stamp the AWB FIRST (visible), transition LAST; idempotent + convergent (AWB stamped + order still PMP → re-run the transition). `cancelUnfulfillable` → `CANCELLED_BY_ADMIN` (releases reservations, voids the shipment); idempotent.

9. **CUR-9: AWB is generated EXACTLY ONCE.** `shipment.awbNumber !== null` is the idempotency gate — a shipment that already carries an AWB is SKIPPED, never re-generated (in real mode this prevents a double Delhivery call / double charge on a BullMQ retry). The supersede chain (idempotency keyed on the old shipment's `supersededAt`) and manual placement honor the same once-only discipline.

**Public Tracking rules (Module 10 — TRK-1 through TRK-9, NON-NEGOTIABLE):**

1. **TRK-1: Webhook AUTHENTICATION precedes storage.** The public `POST /public/tracking/webhooks/:courierCode` endpoint verifies a per-courier HMAC over the EXACT raw request bytes (NOT re-serialized JSON) BEFORE inserting a `courier_webhooks` row. An unauthenticated payload returns 401 and is NEVER stored — the raw ledger is reserved for authenticated payloads only. The HMAC secret lives in env (`TRACKING_WEBHOOK_SECRET_<COURIER>`), referenced from `system_settings.tracking.webhook_secret_ref` (CUR-1 discipline — secret in env, ref in DB). An unset env secret fails closed (every webhook 401s).

2. **TRK-2: Per-payload idempotency at TWO layers.** (a) **Ingest dedup** — `(courierCode, signature)` is the dedup key: same signed body ⇒ byte-identical bytes ⇒ same signature; a duplicate ingest returns 200 with the ORIGINAL `webhookId` and writes no new row. (b) **Processor dedup** — `courier_webhooks.status !== RECEIVED` is the master gate: a BullMQ retry on an already-PROCESSED webhook is a clean no-op; per-side-effect dedup (`delivery_attempts.findFirst({webhookId})`, `tracking_events.findFirst({webhookId, eventType})`) makes a mid-saga re-entry idempotent too. The webhook is marked PROCESSED at the very END of the saga via a guarded `updateMany(where: status=RECEIVED)`.

3. **TRK-3: `tracking_events.eventAt` is the SCAN timestamp; `createdAt` is receive time.** All READS + the monotonic-forward transition guard ORDER BY `event_at`, NEVER `created_at`. The hypertable PARTITIONS on `created_at` (insertion-time partitioning is Timescale's canonical pattern) — ordering ≠ partitioning. Webhook entries pull `eventAt` from the parsed scan payload (`DelhiveryRawScan.eventAtIso`); manual entries (TRK-9) require the operator to supply `eventAtIso` explicitly. `TrackingEventAppendService` NEVER substitutes `now()` for `eventAt` — past-dated scans stay past-dated; backfills land in the correct timeline position.

4. **TRK-4: Monotonic-forward transition guard.** Two-tier in the processor:
   - **ALREADY_AT_TARGET** — `current === decision.targetOrderStatus` → skip transition silently. Covers repeat NDR scans on an already-DELIVERY_FAILED order (the delivery_attempts row is STILL written; the transition is a no-op) and duplicate forward replays.
   - **CURRENT_NOT_IN_ALLOWED_FROM** — `current ∉ decision.allowedFromOrderStatuses` → skip. Covers stale-backward scans (current=DELIVERED, scan=IN_TRANSIT), out-of-order arrivals (current=OUT_FOR_DELIVERY, scan=IN_TRANSIT), and orders past the natural lifecycle (CANCELLED).
   A skipped transition is NORMAL, not an error: the `tracking_event` (and for NDR the `delivery_attempts` row) are recorded; the order is just past or at the target already. Logged at debug. The 409 path from `OrderWriteService.transitionStatus` (STALE_ORDER_STATUS / NOOP / INVALID after a concurrent change) is caught and treated identically — `webhook.status` becomes PROCESSED, NOT FAILED.

5. **TRK-5: `TrackingStatusMappingService` is the SINGLE SOURCE OF TRUTH for scan-status → order-transition translation.** Pure logic, no Prisma, no Order dependency — mirrors `CallOutcomeMappingService` (CC-2). The processor + manual-tracking service both consult it; never duplicated in controllers/other services. **F2 discipline:** the service does an EXHAUSTIVE TypeScript switch over every `ShipmentStatus` — a future enum addition fails to compile until the author consciously routes it to TRANSITION / DELIVERY_ATTEMPT / INFORMATIONAL / REJECT. The 4-kind decision IS the entire behavioral contract; sideEffects deliberately live ONLY on the matrix (TRK-7), never on a mapping decision.

6. **TRK-6: RTO chain — webhook-driven UP TO `RTO_IN_TRANSIT` only; the warehouse `RtoReceiptService.receive()` is the sole authority for `RTO_RECEIVED`.** A `RTO_DELIVERED` scan is INFORMATIONAL (the tracking_event IS written for the customer timeline; NO order transition fires). Driving `RTO_RECEIVED` from a webhook would let a malformed / spoofed scan trigger the conservation-critical WMS-8 RTO finalize chain without physical confirmation. `DAMAGED` scans are INFORMATIONAL for the same shape (`RTO_DAMAGED` is a warehouse-finalize disposition, not a scan terminal). The boundary is verified end-to-end in `tracking-flow.e2e-spec.ts`.

7. **TRK-7: DELIVERED is STOCK-NEUTRAL.** The `OUT_FOR_DELIVERY → DELIVERED` matrix edge carries `sideEffects: []` (M9 commit 12, Model A — the bug-1 fix); `qtyOnHand` decrements EXACTLY ONCE at DISPATCH (CUR-3, `DISPATCH_STOCK`); DELIVERED never touches stock. M10's responsibility is to NEVER reach back into the stock layer for DELIVERED — no `DELIVERY_STOCK` side-effect, no movement from the processor. Pinned at TWO layers: (a) the M9 matrix unit test (the edge has `sideEffects:[]`); (b) the M10 `tracking-status-mapping.service.spec.ts` matrix-consistency suite re-asserts the matrix edge AND the M10 `tracking-flow.e2e-spec.ts` `TRK-7 CONSERVATION re-verify` test drives a webhook-delivered order full lifecycle and asserts `qtyOnHand` STAYS 8 at DELIVERED.

8. **TRK-8: Public tracking is anti-enumeration by THREE mechanisms.** (a) HMAC on webhook ingest (TRK-1) keeps spoofed scans out, so a published AWB can't be used to inject bogus timeline events. (b) `PublicTrackingReadService.findByAwb` returns a CUSTOMER-SAFE projection only — no internal IDs (orderId/shipmentId/webhookId/sellerId), no recipient PII (name/phone/full address), no internal status codes (rawCourierStatus), no precise coordinates; only the AWB, courier display name, coarse current status, destination city, ETA, and `isVisibleToCustomer=true` scan timeline (the M10 processor sets `isVisibleToCustomer=false` on UNMAPPABLE/REJECT audit scans — they NEVER reach the public timeline). (c) Per-IP rate limit (`tracking.public_lookup_rate_limit_per_min`, seeded 30) on the open lookup endpoint. 404s return a SINGLE generic body for unknown / soft-deleted shipment / soft-deleted courier / unissued AWB — no signal leakage on miss.

9. **TRK-9: Manual scan recording uses the SAME mapping + saga as webhooks.** `ManualTrackingService.recordScan` (admin-only — `MANUAL_PLACEMENT_ADMIN` / `WAREHOUSE_SUPERVISOR` / `SUPER_ADMIN` via `requireStaffRoles`) consults `TrackingStatusMappingService` (TRK-5), runs the same monotonic-forward guard (TRK-4), and writes the `tracking_event` with `source=MANUAL_ENTRY`, `actorType=STAFF`, `actorId=staff.id`, `webhookId=null`. For DELIVERY_ATTEMPTED: same delivery_attempts-FIRST saga ordering as the webhook processor. The operator supplies `eventAt` explicitly (TRK-3) — backfills land in the correct timeline position. NO master idempotency gate (manual flow has no courier_webhooks row to dedup against); a double-submit produces two rows discoverable via the timeline.

**Module 10 architecture (R3 + facade):**
- Module split (all leaf consumers — nothing imports them except `AppModule`):
  - `tracking-events` — the SHARED primitives. `TrackingStatusMappingService` (TRK-5, pure logic, no Prisma); `TrackingEventAppendService` (TRK-3 append-only writer + the `latestForShipment` eventAt-DESC read used by the processor guard and the public read).
  - `tracking-ingestion` — `WebhookAuthService` (TRK-1 HMAC), `WebhookIngestService` (TRK-1/2 store-then-process), `PublicWebhookController` (open endpoint, IP-throttled), `TrackingWebhookQueue` + `TrackingWebhookWorker` (BullMQ; backoff array shared with M9 — `courier.awb_job_retry_backoff_ms`), `WebhookProcessorService` (the saga — visible-vs-silent: delivery_attempts FIRST, tracking_event SECOND, transition LAST).
  - `tracking-public` — `PublicTrackingReadService` (customer-safe projection), `PublicTrackingController` (`GET /public/tracking/:awbNumber`, open, IP-throttled to 30/min).
  - `tracking-manual` — `ManualTrackingService`, `AdminManualTrackingController` (`POST /admin/tracking/shipments/:shipmentId/manual-scan`).
- Cross-module export surface: `tracking-events` exports `TrackingStatusMappingService` + `TrackingEventAppendService` to its consumers within M10 (the processor + manual-tracking service); the other three modules export NOTHING externally.
- The webhook processor saga is the **SIXTH canonical application** of the saga + visible-vs-silent failure-ordering pattern. The manual-tracking saga is the seventh.
- The `DelhiveryClient.normalizeScan` slice (M10 commit 6 / F8) is the FOURTH capability service of the M9 adapter — joins `generateAwb` / `fetchLabel` / `checkServiceability`. STUB MODE keys on prefixed raw codes (`DLV-IN-TRANSIT`, `DLV-OFD`, `DLV-DELIVERED`, `DLV-NDR`, `DLV-RTO-INIT`, `DLV-RTO-IT`, `DLV-RTO-DEL`, `DLV-LOST`, `DLV-DAMAGED`); real-mode mapping is a NEW `TODO(delhivery-api)` seam (joining M9's existing 6).
- **M10 HTTP endpoint map:** `POST /public/tracking/webhooks/:courierCode` (open, HMAC-authenticated, IP-throttled by default 100/min); `GET /public/tracking/:awbNumber` (open, IP-throttled to 30/min); `POST /admin/tracking/shipments/:shipmentId/manual-scan` (staff-JWT, `requireStaffRoles([MANUAL_PLACEMENT_ADMIN, WAREHOUSE_SUPERVISOR, SUPER_ADMIN])`).

**Mapping ↔ Matrix bidirectional consistency discipline (M10 commit 9):** `TrackingStatusMappingService` is the M10 parallel to `CallOutcomeMappingService` (CC-2 / M7): a single-source mapping service that translates an external event (webhook scan / call outcome) into an order transition. **The mapping's `allowedFromOrderStatuses` for each TRANSITION / DELIVERY_ATTEMPT decision MUST mirror the M9 OrderStateMachineService matrix's actual inbound edges to `targetOrderStatus` EXACTLY** — drift in either direction is a bug: a missing matrix inbound (mapping omits a `from`) is a silent regression (the processor's monotonic-forward guard skips a legitimate forward transition — the exact class M10 commit 9 caught and fixed for OUT_FOR_DELIVERY); an extra mapping `from` (matrix has no edge) produces a noisy 409 the guard didn't catch. The `tracking-status-mapping.service.spec.ts` "matrix consistency (F6)" describe block PINS this bidirectional equivalence as a regression test — drift in M9's matrix or M10's mapping will fail this suite. **M11's `NotificationEventMappingService` (NOTIF-4) is the THIRD instance** of this single-source-mapping pattern — same shape (pure logic, no Prisma, F2-exhaustive switch over `OrderStatus`, decision returns N fan-out targets per resolved status), same discipline. Apply when adding a future mapping service; the pattern is now a documented convention with three named instances.

**Notification rules (Module 11 — NOTIF-1 through NOTIF-8, NON-NEGOTIABLE):**

1. **NOTIF-1: Best-effort, NEVER blocks / rolls back the transition.** The order lifecycle emit is a POST-COMMIT hook (the 6th in `OrderWriteService.transitionStatus`, after CC-6 dequeue + shipment-provision void + audit chain); the bus' `emit()` wraps `subject.next()` in try/catch and never re-throws. The listener handles each event via `void this.handle(event).catch(...)` — a handle() rejection is logged + swallowed at THREE layers (the bus emit wrapper, the listener subscribe wrapper, the handle() catch). NEVER make any listener-side error propagate up to the transition; the transition is the durable fact, notifications are a reflection of it.

2. **NOTIF-2: Store-then-send with composite-key dedup.** `NotificationLedgerService.enqueue()` INSERTs the notification_logs row in PENDING/QUEUED state FIRST, carrying `eventId = order_status:<statusEventId>`; the partial-unique `(event_id, recipient_type, recipient_id, channel, template_code) WHERE event_id IS NOT NULL` is the dedup gate — a re-emit on the same lifecycle event lands a P2002 the service catches and converts to `kind: 'DEDUPED'`. The BullMQ send job enqueues AFTER the row exists. `EmailDispatchService.send` UPDATEs the pre-created row (`existingNotificationLogId`) on outcome, preserving the row id as the durable dedup anchor; legacy fire-once callers (the 8+ pre-M11 sites) leave `existingNotificationLogId` unset and get the unchanged CREATE path.

3. **NOTIF-3: Fan-out independence per target.** The listener resolves N fan-out targets per lifecycle event (mapping returns 0/1/2 — seller+customer, customer-only, seller-only, or none); the listener loops, wrapping EACH `ledger.enqueue()` in its OWN try/catch — one target's failure NEVER aborts the loop or leaks into the other targets. The composite-key gate per row means a BullMQ retry on one target never touches the other; a re-emit double-sends none.

4. **NOTIF-4: Single-source mapping (THIRD instance).** `NotificationEventMappingService.resolveForOrderStatus(to)` is the SOLE owner of "order status → outbound notifications"; pure logic, no Prisma, no Order dependency. **F2 discipline:** EXHAUSTIVE TypeScript switch over every `OrderStatus` — a future enum addition fails to compile until the author consciously routes it to a fan-out list (possibly `[]`). The Q5 table is encoded ONLY here; never duplicated in the listener / controllers / other services. Joins `CallOutcomeMappingService` (CC-2) and `TrackingStatusMappingService` (TRK-5) as the three single-source mapping services in the codebase.

5. **NOTIF-5: Order module is unaware of notifications.** The order module never imports `NotificationsModule` or any notification service. The wiring goes through the R3 `OrderLifecycleEventBus` — order publishes; notifications subscribe. The bus is the dependency-free shared primitive (R3 split #4 after M5/M7/M8). A future Phase-2 multi-instance API would swap the in-process Subject for Redis pub/sub at this exact seam; the publisher / subscriber API stays the same.

6. **NOTIF-6: Dev-mode stub via empty `RESEND_API_KEY`.** No separate adapter; `ResendService` checks `env.resendApiKey` and either calls the real SDK (production) or emits `[DEV] Would send email` log lines (development + e2e). The dispatch service writes the notification_logs row regardless (status SENT in dev, status SENT/FAILED in prod). The e2e tests rely on this — they assert against notification_logs rows AND the `[DEV] Would send email` log lines, never against actual Resend delivery.

7. **NOTIF-7: Reuses the existing EmailModule substrate.** M11 ADDS the lifecycle fan-out layer (mapping + ledger + listener) on top of M1's already-built EmailQueue / EmailWorker / EmailDispatchService / TemplateRenderService + the seeded notification_templates. The substrate was NOT duplicated; the M11 ledger's CREATE-then-UPDATE pattern is the ONE extension point added to EmailDispatchService (`existingNotificationLogId` path). The pre-M11 fire-once callers (auth/seller-mgmt/inventory/category-proposal) are UNCHANGED.

8. **NOTIF-8: Missing recipient address lands a SKIPPED row, NOT FAILED.** A customer order with no `recipientEmail` snapshot (the ORD-6 immutable customer email) is a foreseeable Phase-1A reality (a CSV row that omitted the email, an admin manual entry that skipped it). The listener detects null toEmail at resolve time; the ledger writes a `status: SKIPPED` row carrying the same `eventId` so a re-emit STILL consumes the dedup gate (no second SKIPPED row). No BullMQ enqueue. SELLER toEmail is non-null by schema; a null SELLER address is a data integrity error, not a runtime path. Phase-2 SMS/WhatsApp will generalize "no resolvable address" to "no phone / no whatsapp number" at this same gate.

**Module 11 architecture (R3 + facade):**
- The `OrderLifecycleEventBus` PRIMITIVE lives in a standalone `lifecycle-events` module (rxjs Subject-backed, NO Order dep, NO Notifications dep; imported by both `OrderModule` and `NotificationsModule`). The FOURTH successful R3 split after `inventory-shared/inventory-stock` (M5), `call-queue` (M7), `shipment-provision` (M8). The exported surface is `OrderLifecycleEventBus` only.
- `NotificationsModule` houses the listener + the supporting services:
  - `NotificationEventMappingService` (NOTIF-4, pure logic, no Prisma — single-source mapping, third instance).
  - `NotificationLedgerService` (NOTIF-2/3/8 — store-then-send + composite-key dedup gate + SKIPPED row writer; reuses `EmailQueue` via `EmailModule` import).
  - `NotificationListener` (NOTIF-1/3/5 — the bus subscriber; `OnApplicationBootstrap` subscribes, `OnModuleDestroy` unsubscribes + DRAINS in-flight `handle()` promises; `drainInFlight()` exposed publicly so the e2e harness can quiesce listener work between tests — the M11 follow-up commit codifies this).
- Cross-module export surface: `NotificationsModule` exports NOTHING — the listener subscribes to the bus on bootstrap; no other module needs to call into M11. The listener is internal by construction.
- Email substrate (`EmailModule`) is REUSED unchanged: `EmailQueue` (BullMQ producer), `EmailWorker` (consumer), `EmailDispatchService.send` (the only extension point — the `existingNotificationLogId` UPDATE path landed in M11 commit 4), `TemplateRenderService` (Nunjucks; `throwOnUndefined: false` so unused template vars stringify to empty), `ResendService` (real SDK in prod; `[DEV] Would send email` stub when `RESEND_API_KEY` is empty).
- **No new BullMQ queue.** M11 wires its lifecycle fan-out through the existing `email` BullMQ queue / worker. The pre-M11 callers continue to use it directly (legacy CREATE path); M11 lifecycle callers go through the ledger's CREATE-then-enqueue + UPDATE-on-send flow.
- **No new HTTP endpoint.** M11 has NO public surface — the fan-out is driven by `OrderWriteService.transitionStatus`'s post-commit emit. Admin/ops resend or visibility UIs are deferred to M12.

**E2E listener drain (M11 follow-up — locked discipline):** The bus' `emit()` is synchronous; the listener spawns `handle()` async via `void this.handle(event).catch(...)`. In production this is exactly the contract; in e2e it leaks past test/suite boundaries unless explicitly drained. **TWO drain hooks must be honored:**
- `NotificationListener.onModuleDestroy()` unsubscribes FIRST then `Promise.allSettled([...this.inFlight])` — Nest awaits this in `app.close()`, so suite-boundary contamination is impossible.
- `NotificationListener.drainInFlight()` is the public BETWEEN-TEST drain — `resetAuthState(prisma, app)` calls it BEFORE the TRUNCATE cascade. Without this drain, a leaked notification_logs INSERT's FK `RowShareLock` on orders/shipments deadlocks the harness's `AccessExclusiveLock` TRUNCATE (`40P01`). Every e2e spec passes `h.app` so this is automatic; specs that don't touch orders may use the legacy single-arg form.

When adding ANY future post-commit fire-and-forget side-effect that writes via async DB calls — the same drain pattern MUST apply: track in-flight Promises in a Set, expose a public `drainInFlight()`, await in `onModuleDestroy()`. The leak shape is universal under async fire-and-forget; the M11 fix is the canonical reference.

**Module 9 architecture (R3 + adapter):**
- The Delhivery integration is built against a clean `DelhiveryClient` ADAPTER INTERFACE. **STUB MODE** (empty `courier.delhivery_api_base_url`) is the Phase-1A default — deterministic, no network (postal-code-keyed branches drive every test path: `999999` transient failure, `000000` non-serviceable — the latter is not a valid PIN so e2e drives failure via `999999`). **REAL MODE** marshals + calls Delhivery's wire API; every real-contract spot is flagged `TODO(delhivery-api)` and throws until validated against Delhivery's sandbox (a SEPARATE task — the wire format was not known when M9 was built; the orchestration above the adapter is fully built + tested in stub mode).
- Module split: `courier-shared` (`CourierCredentialService`), `courier-delhivery` (the adapter — `DelhiveryHttpService`/`DelhiveryAwbService`/`DelhiveryLabelService`/`DelhiveryServiceabilityService`), `courier-awb` (the AWB generation saga + BullMQ worker), `courier-dispatch` (`DispatchHandoffService` + endpoint), `courier-manual-placement` (`ManualPlacementService` + endpoints). The M8 R3 primitive `shipment-provision` is reused (`ShipmentNumberingService` for supersede replacements).
- The AWB generation saga is the **FIFTH canonical application** of the saga + visible-vs-silent failure-ordering pattern.
- **M9 HTTP endpoint map** (all staff-JWT, `requireStaffRoles` inline RBAC): `POST /admin/courier/manifests/:manifestId/confirm-handoff` (`WAREHOUSE_SUPERVISOR`/`SUPER_ADMIN` — CUR-4 dispatch handoff); `POST /admin/courier/manual-placement/shipments/:shipmentId/place-awb` and `.../cancel` (`MANUAL_PLACEMENT_ADMIN`/`SUPER_ADMIN` — CUR-8). AWB generation itself has NO endpoint — it is BullMQ-driven off `ManifestService.close` (CUR-2); `AwbGenerationJobService.processManifest` is public as the manual ops re-trigger.

### Saga: visible-vs-silent failure ordering (generalizable rule)

When a saga cannot be one Postgres transaction (because a cross-module service owns its own tx — M5 reservations, `OrderWriteService.transitionStatus`, etc.), **order the steps so an orphaned intermediate state is SELF-ANNOUNCING (visible, recoverable), never silent.** The source-of-truth side-effect goes FIRST and durable; the dependent reflection goes LAST; the whole thing is idempotent on retry.

The principle, generalized: ask "if we crash between step N and step N+1, does the next caller's view of the world correctly tell them what happened?" If yes (a half-finalized order in `RTO_RECEIVED` says "movements applied, transition pending — retry me" via the gate-2 query), the ordering is correct. If no (an order showing `RTO_RESTOCKED` while stock is silently missing — Option B from the WMS-8 pre-fix discussion), the ordering is INVERTED — flip it.

Canonical applications:
- **WMS-8 RTO finalize**: releases + WRITE_OFF movements FIRST, transition LAST. A crash after movements leaves order in `RTO_RECEIVED` (visible, recoverable); a crash before movements rolls back atomically.
- **PickExecutionService.complete / PackService.complete**: operational stamp (shipment.pickCompletedAt / packCompletedAt) FIRST (guarded `updateMany` idempotent), authoritative transition LAST. A crash after stamp leaves a re-callable PENDING_PICK / PICKED with the original timestamp preserved.
- **RtoReceiptService.receive**: stamp `rtoReceivedAt` FIRST, transition LAST. Same shape.
- **M6 saga (ORD-3)**: RESERVE pre-tx (fail-routing to OUT_OF_STOCK is the visible alternative); RELEASE/FULFILL post-commit idempotent.
- **M9 DISPATCH_STOCK (CUR-3, the bug-1 fix)**: DISPATCH movements pre-tx (durable physical decrement FIRST), the DISPATCHED transition tx, `fulfill()` post-commit. A crash after the movements leaves the order `PENDING_DISPATCH` with qtyOnHand correctly decremented (visible, recoverable — the shipment-grained gate skips re-application on retry).
- **M9 manual placement (CUR-8)**: stamp the manual AWB on the shipment FIRST (operational, visible), transition `PENDING_MANUAL_PLACEMENT → DISPATCHED` LAST. A crash between leaves the order PMP with the AWB stamped — visible; a retry converges by re-running the transition.

**The pattern held for M9 (the AWB generation + DISPATCH_STOCK + manual-placement sagas — the fifth+ applications) AND M10 (the webhook processor + manual-tracking sagas — the sixth+ applications).** Canonical M10 specifics: for the DELIVERY_ATTEMPTED scan, the `delivery_attempts` row is the durable source-of-truth (an NDR happened) — written FIRST; the `tracking_event` is the timeline record — written SECOND; the `OrderWriteService.transitionStatus` is the reflection — LAST. A crash anywhere between leaves `courier_webhooks.status=RECEIVED`; the BullMQ retry re-enters at the master idempotency gate, hits the per-side-effect dedup (webhookId-keyed), and re-attempts the transition idempotently — convergent. When designing any future saga: write down the cross-module step that owns its own tx, identify the local state-of-truth, put the durable side-effect FIRST, and verify the intermediate-state retry-convergence story before coding. The CP1 pre-flight review pattern is the enforcement mechanism (the WMS-8 conservation bug demonstrated that even with this principle understood, a leg-by-leg unit test can pass while a full-lifecycle conservation e2e catches the real issue — keep the cross-lifecycle invariant tests; M10's `TRK-7 CONSERVATION re-verify` e2e is the parallel guard for "DELIVERED never re-acquires a stock side-effect").

**Shipment rules:**
1. Webhook idempotency: M10 implements TRK-2's two-layer dedup — ingest-time `(courierCode, signature)` (same signed body ⇒ duplicate; 200 + original webhookId, no new row) + processor-time master gate (`courier_webhooks.status !== RECEIVED` short-circuits a BullMQ retry) + per-side-effect dedup keyed on `webhookId` (tracking_events, delivery_attempts). The historical "(courierCode, awbNumber, eventType, externalEventId)" dedup spec is superseded by signature-based dedup — see TRK-2.
2. Status transitions enforced by state machine (16 statuses).
3. AWB lifecycle: when superseded (e.g., Delhivery rejected → Bluedart), new shipment gets new AWB. Never reassign.
4. Webhook receipt acknowledged ASAP: write raw row, return HTTP 200 within 500ms, process async via BullMQ (M10 implements this — the public controller returns 200 with `webhookId` immediately after the dedup + insert; processing is the BullMQ `TrackingWebhookWorker`).

**Credential rules:**
1. Decryption key NEVER in DB. Always env var (`COURIER_CREDENTIALS_KEY_<version>`).
2. Every decrypt writes an `audit_logs` row before returning plaintext.
3. Plaintext credentials are NEVER logged, NEVER serialized to API responses, NEVER cached longer than 5 min.

**Pricing rules:**
1. Calculate charges at order creation, not display time. Persist to `order_charges` with full `computationContext` JSON.
2. GST (18%) applies after all surcharges: `gst = (baseShipping + sum(surcharges)) * 0.18`.
3. Historical accuracy: past orders show charges as persisted. Don't recompute from current rate cards.

**Notification rules (general — see also Module 11 invariants NOTIF-1..8 above):**
1. Send via BullMQ workers only. API endpoints enqueue; workers send.
2. Throttle per (recipient, template). Check `notification_logs` before send; mark THROTTLED if limit exceeded.
3. Respect seller's quiet hours for non-urgent categories.
4. **Two idempotency regimes coexist on `notification_logs`** — pre-M11 fire-once callers (auth/seller-mgmt/inventory/category-proposal) dedup via the polymorphic `(templateCode, recipientType, recipientId)` LOOKUP in the caller service BEFORE enqueueing; the row carries NO `eventId`. M11 lifecycle fan-out callers set `eventId = order_status:<statusEventId>` and rely on the partial-unique `(event_id, recipient_type, recipient_id, channel, template_code) WHERE event_id IS NOT NULL` (NOTIF-2). The two coexist because the partial-unique only fires when `eventId` is present. **NEW lifecycle-event fan-out paths MUST set `eventId`** (the partial-unique is their only protection). **DO NOT add `eventId` to legacy callers** without auditing their dedup logic — they currently rely on a template-code lookup that ignores `eventId`. (See phase-1a-debt M11 entry "Two idempotency regimes" for the migration path.)

**Outbound webhook rules:**
1. Sign every payload with HMAC-SHA256 using endpoint's `secretKey`.
2. Retry policy (BullMQ): 5 attempts, exponential backoff (30s, 5m, 30m, 6h).
3. Auto-disable endpoint after N consecutive failures (default 50, configurable via `system_settings`).
4. Idempotency: unique constraint on `(endpointId, eventType, eventId, attemptNumber)` prevents double-send.

**Status-change rules (general):**
1. Any status-change service wraps update + side-effects (token revoke, note, audit, email enqueue) in one `prisma.$transaction` — EXCEPT where a cross-module service owns its own tx (e.g., M5 stock services), in which case use the SAGA pattern (see ORD-3).
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
- **inventory-stock** (cross-module surface): `StockReadService`, `StockReservationService`, `StockPickAllocationService`. **External consumers (Modules 6, 8) import this module and see only these three.**

**General:**
1. All money stored as `Decimal`, INR canonical. BDT for display only via FX.
2. All phone numbers E.164 (+91xxx, +880xxx). Validate at app boundary.
3. All timestamps UTC. Display timezone is a per-user preference.
4. Soft delete via `deletedAt` for user-facing data. Hard delete for tokens, sessions, transient/immutable rows.
5. Audit log every sensitive action via `audit_logs` (auth, admin actions, sensitive data access). Severity scale: LOW / MEDIUM / HIGH / CRITICAL — CRITICAL reserved for god-mode and similar invariant-breach actions.

**Frontend invariants (Module 12 — FE-1 through FE-6, NON-NEGOTIABLE):**

1. **FE-1: Access token in browser MEMORY only.** NEVER `localStorage` / `sessionStorage` / IndexedDB / `document.cookie` — XSS-exfiltratable surfaces are forbidden. The `__Host-{staff,seller}Refresh` HttpOnly cookie is the SOLE durable session anchor. The access token lives in a module-scope `AccessTokenStore` (in `packages/api-client`); a page reload wipes it; the SSR boot path re-hydrates identity via the cookie. Named enforcement point: `packages/api-client/src/auth/token-store.ts` exposes only `get`/`set`/`clear`/`subscribe` with no persistence.

2. **FE-2: UI role-gating is COSMETIC. The server is the ONLY security boundary.** Hiding a control the role can't use is UX. Every admin action hits an already-`requireStaffRoles`-guarded (or to-be-guarded — Phase-1A defers some) endpoint that rejects regardless of what the UI showed. The UI surfaces the server's verdict `[CODE] message` VERBATIM; it MUST NOT pre-empt with a client-side mirror of the server's policy. Named enforcement point: `apps/admin/src/tests/god-mode-fe2.test.tsx` + `seller-status-fe2.test.tsx` (7 tests) — specifically the "server-rejection VERBATIM" test that returns `[FORCE_MUTATION_REASON_TOO_SHORT]` from a UI-passing input and asserts the verdict appears in the DOM unchanged. This is the codified guard against the FE-2-erosion mode (a future refactor accidentally moves enforcement client-side).

3. **FE-3: The browser talks only to its OWN origin.** No cross-origin browser→API calls. Each frontend (admin / seller / track / marketing) talks to its own subdomain only; a Next.js route-handler proxy at `app/api/[...path]/route.ts` forwards `/api/*` to the actual API origin server-to-server. The `__Host-` cookie is bound to the frontend origin (where Next.js set it on behalf of the API); the proxy moves bytes in both directions. This is what makes `__Host-` work across the admin/api split. Named enforcement point: `apps/admin/src/app/api/[...path]/route.ts` (the proxy itself) + `apps/admin/CP1_VERIFICATION.md` (the 7-step live verification that proves Set-Cookie passthrough end-to-end).

4. **FE-4: Server components authenticate via the cookie → NON-ROTATING `/me`. Rotation is CLIENT-driven only.** Server-side rotation would race the client's silent-refresh and burn the legitimate session via the API's reuse-detection family-burn (`security.refresh_replay_detected` HIGH audit). The SSR path uses `RefreshTokenService.validateByPlaintext` — a NEW (M12 commit 1) read-only validation method strictly distinct from `rotate()`: same lookup, but revoked rows return `null` instead of firing the family-burn. Named enforcement point: `apps/api/test/e2e/staff-auth.e2e-spec.ts` "cookie path is read-only" test (same cookie works twice, no new refresh row created) + `packages/auth/src/tests/ssr-identity.test.ts` "fetchImpl EXACTLY ONCE — does NOT call /refresh". The two together make the non-rotation property impossible to silently lose.

5. **FE-5: `packages/api-client` + `packages/auth` are identity-parameterized.** Staff and seller share session mechanics; the identity kind (`'staff' | 'seller'`) is a constructor parameter, not a feature switch. The same `ApiClient` + `AuthProvider` + `resolveSsrIdentity` shape serves both apps; per-identity differences (StaffMe.role vs SellerMe.companyName/status) are encoded in their own response types. apps/admin uses staff; apps/seller (M13+ frontend cycle) uses seller — the packages don't change. Named enforcement point: the `IdentityKind` type at the public API + `endpoints/auth.ts` having both `StaffMe` and `SellerMe` interfaces.

6. **FE-6: Semantic status colors + design tokens live in `@skydrop/ui` and are the SINGLE SOURCE OF TRUTH.** Never hardcoded hex in components. All four frontends inherit them. The 8 semantic kinds (draft/pending/confirmed/in-transit/delivered/rto/failed/cancelled) cover the full 28-value `OrderStatus` + 16-value `ShipmentStatus` vocabularies via F2-exhaustive switches (`orderStatusKind`/`shipmentStatusKind` in `packages/ui/src/status`); a future enum addition fails to compile until the author consciously assigns a kind. Components stay in `apps/admin/src/components/ui` until apps/seller forces extraction (locked decision — tokens are shared NOW, components are not, because the apps/seller's needs will shape the component API more accurately than premature abstraction). Named enforcement point: the `never` return in the exhaustive switches + `status-badge.tsx` reading ONLY from `kindTokens(kind)` (CSS variables); a `grep -r '#[0-9a-fA-F]\{6\}' apps/admin/src/components/ui` returns nothing.

**Module 12 architecture (frontend foundation — apps/admin + the four shared packages):**

- **Identity-parameterized shared packages**:
  - `@skydrop/ui` — design tokens ONLY (FE-6): CSS variables + status-kind mapping + spacing/type/radii. Dark theme PRIMARY; `[data-theme='light']` override. No React, no components. `"type": "module"` ESM-only.
  - `@skydrop/api-client` — typed same-origin fetch client with the **single-flight refresh** coordinator (the load-bearing piece for FE-2 / FE-4). On 401 → ONE `/refresh` per concurrent-401 cluster → retry. Without this, N concurrent 401s would rotate N times → trip the API's reuse-detection family-burn against a LEGITIMATE session. The `AccessTokenStore` (in-memory, subscribable) lives here. `IdentityKind = 'staff' | 'seller'` is the parameter.
  - `@skydrop/auth` — server + client subpaths.
    - `/server`: `resolveStaffSsrIdentity` / `resolveSellerSsrIdentity` — the SSR cookie→/me path. NEVER calls /refresh.
    - `/client`: `<AuthProvider>`, `useApiClient`, `useStaffIdentity`, `hasStaffRole`. Identity-parameterized via generic.
  - `@skydrop/db` — already existed (M0); the FE packages consume its enum types.

- **The `/api/*` same-origin proxy (FE-3)** — implemented as a Next.js route handler at `apps/admin/src/app/api/[...path]/route.ts` (NOT a `next.config.mjs` rewrite). Route handlers evaluate `API_ORIGIN` at REQUEST time, so env changes don't require rebuilding. The proxy:
  - Forwards GET/POST/PATCH/PUT/DELETE/HEAD/OPTIONS to `${API_ORIGIN}/{path}`.
  - Strips RFC 7230 hop-by-hop headers in both directions (`connection`, `keep-alive`, `transfer-encoding`, `content-length`, `content-encoding`).
  - Streams the response body unchanged INCLUDING `Set-Cookie` headers — the linchpin of the SSR-auth model. (Verified end-to-end by CP1_VERIFICATION.md step 3: refresh-through-proxy round-trip with the new `__Host-staffRefresh` cookie set via the proxy and step 5's /me with the new cookie succeeding.)
  - `cache: 'no-store'` on upstream — admin data is authenticated + dynamic; never cache.

- **The (authed) route-group gate** (`apps/admin/src/app/(authed)/layout.tsx`) — reads `__Host-staffRefresh` from `next/headers` cookies(), calls `resolveStaffSsrIdentity` (FE-4), redirects to `/login` on 401, throws on 5xx (rendered by `error.tsx` as "service unavailable" — NOT "logged out", which would mask outage). On 200 → hydrates `<AuthProvider<StaffMe>>` with the identity. QueryProvider + AuthProvider mount at this layout root only; the /login layout is bare.

- **Frontend test runner split (intentional)**: apps/api uses **jest** (NestJS preset, full e2e harness); apps/admin + the FE packages use **vitest** (faster, native ESM, JSX without extra config, and the runtime split keeps the test contexts decoupled). The two never run together in the same process; turbo orchestrates them independently. Document this when adding apps/seller — same vitest setup applies.

- **Components stay in apps/admin until apps/seller lands** (locked decision per FE-6 commentary). Token-driven, extraction-ready: NO `@/...` imports inside `apps/admin/src/components/ui` — the entire folder lifts to `packages/ui/src/components/` when apps/seller forces the shape. The reason for delay: apps/seller's needs will shape the component API more accurately than premature abstraction would.

- **The FE-2 boundary discipline (the most important M12 invariant)**: the UI's escalating chrome conveys gravity; the SERVER enforces every guardrail. When the server rejects with `ApiError {code, message}`, the UI displays `[code] message` verbatim — the test in `god-mode-fe2.test.tsx` pins this. When you write a new admin action, mirror this pattern: confirm modal → submit → on success invalidate the appropriate query-key prefix; on failure surface the server's `[code] message` without pre-emption. This is what makes the admin app safe to evolve: every state-changing surface inherits the FE-2 discipline by construction.

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
- No non-null assertions (`!`). `--max-warnings 0` enforces. Use nullish-coalescing fallbacks or proper type narrowing.
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
- **Cross-module order access** goes via the two services `OrderModule` exports: `OrderReadService` (reads) and `OrderWriteService.transitionStatus()` (the sole write boundary). All other order services are internal to `OrderCoreModule`; never imported by other domains.
- **Cross-module call-queue access** goes via the single service the standalone `call-queue` module exports: `CallQueueService` (`enqueueOrder` / `enqueueAgain` / `dequeueOrder`). `call-center` exports NOTHING externally; its `CallAttemptService` / `AgentSettingsService` / `CallAssignmentService` / Admin* services are internal.
- **Cross-module shipment-provision access** goes via the single service the standalone `shipment-provision` module exports: `ShipmentProvisionService` (`provisionFromSnapshot` / `voidForOrder`). The four warehouse modules (`warehouse-pick`, `warehouse-pack`, `warehouse-manifest`, `warehouse-rto`) export NOTHING externally — they are leaf consumers; their services are intra-module only. `ManifestService` is exported within `WarehouseManifestModule` for intra-warehouse consumption (by `warehouse-pack`'s `PackService.complete` for WMS-7 auto-attach) but NOT cross-domain.
- **Warehouse direct stock writes** import `InventorySharedModule` for `StockMutationService.apply(tx)` (the only sanctioned writer, INV-1) — same shape as `inventory-adjustment` / `inventory-receipt`. Cross-module READS still go via `inventory-stock` (`StockReadService` / `StockReservationService` / `StockPickAllocationService`).

### Facade module pattern (Modules 4-6 surfaced)

When a module needs to expose a narrow cross-module surface while keeping internal services from leaking:

- **Catalog/Inventory pattern**: split services across two modules (e.g., `inventory-shared` internal + `inventory-stock` external). External module imports internal module; external module's exports list is the cross-module surface.
- **Order pattern (NestJS-specific)**: NestJS forbids re-exporting an imported module's providers (UnknownExportException). The Module-5-style narrow facade required splitting into `OrderCoreModule` (internal) + `OrderModule` (provides Read/Write itself, drawing internal deps from the imported core). **Any future facade module must PROVIDE the exposed services itself, not re-export them.**
- **R3 shared-primitive pattern (Module 7)**: when two domains each need a cross-cutting primitive and wiring it into either creates a module cycle (here `order` ↔ `call-center` via the call queue), extract the primitive into its OWN dependency-free module (`call-queue`) imported by both. It depends on neither side → the cycle disappears with NO `forwardRef`. **Prefer this over `forwardRef` for M8/M9 — `forwardRef` is fragile and accumulates risk; the R3 extraction is explicit and was validated end-to-end in M7 (the full DI graph boots, no circular dependency).**
- The split is convention-not-lint — internal modules are importable directly. Code review and CLAUDE.md MUSTs are the enforcement.

### Cross-module integration with M5 stock services (saga pattern)

The M5 reservation services (`StockReservationService.reserve()`, `.release()`, `.fulfill()`) own their own version-CAS transactions and **take no tx parameter**. They cannot be composed into another module's `prisma.$transaction`. Any M5↔M6/M8/M9 integration must use the documented **saga pattern**:

- **Pre-tx fail-routing**: attempt the M5 call before opening the orchestrating tx; on `InsufficientStockError`, route to a non-terminal landing state (e.g., M6's OUT_OF_STOCK) rather than blocking
- **Local-tx atomic**: the orchestrating module's own row + events + audit are one tx
- **Compensating release on tx-fail**: if the orchestrating tx fails AFTER the M5 reserve succeeded, call `release()` as compensation
- **Post-commit idempotent**: RELEASE/FULFILL calls happen AFTER the orchestrating tx commits (mirrors INV-5's post-commit cache/alert pattern); they are idempotent by design so retry is safe

The canonical reference implementation is `OrderWriteService.transitionStatus()` in M6. M8 (warehouse pick) and M9 (courier dispatch) will both consume this pattern. **Never attempt a nested or distributed transaction across module boundaries.**

**Module 7 was the THIRD successful application** (CallAttemptService → transitionStatus → M5 reserve, the first from outside the order domain) and it composed with NO friction — the pattern is proven for M8/M9. M7 also contributed a reusable companion: the **dual-path idempotent dequeue callback** (CC-6). When two independent flows can both legitimately perform the same idempotent cross-module side-effect (here: the attempt flow closes the queue entry in its own tx; the post-commit `transitionStatus` also dequeues), make the side-effect a no-op when already done (`{dequeued:0}`) and let BOTH paths call it unconditionally — far simpler and race-safer than coordinating "who owns the close". Reuse this when an M8/M9 callback can be reached via more than one trigger.

**Module 8 was the FOURTH+ application** of the saga family (M8 commits 4-16 produced multiple instances): `PickExecutionService.complete` / `PackService.complete` / `RtoReceiptService.receive` all use the **visible-vs-silent failure ordering** principle (see WMS-8 + the dedicated section below) — operational stamp FIRST, authoritative transition LAST. `RtoDispositionService.finalize` (WMS-8) is the most complex application: releases first, WRITE_OFF movements second, transition last, two-gate idempotency. `ManifestService.close` (WMS-6) extends the pattern to N-shipment fan-out (per-shipment transitions collected as `result.failures` rather than aborting). **M8 also contributed the R3 snapshot-DTO refinement** for primitives needing upstream data: `shipment-provision` takes a `ProvisionShipmentInput` DTO (recipient + item snapshot) rather than resolving via OrderReadService — keeps the primitive dependency-free, mirroring how `call-queue` takes `orderId`. M9's AWB generation saga will be the next canonical application of the saga + visible-vs-silent + R3 patterns.

### Testing

- Unit tests use mocked Prisma (or in-memory fakes for transaction-sensitive logic).
- E2E tests run against the `skydrop_test` database (separate from dev) on logical Redis DB 1.
- E2E global setup creates DB, runs migrate deploy + seed; teardown drops DB.
- **Cascading reset helpers:** when adding a feature module with tables that FK to `sellers` (or any other reset-critical entity), add a `reset<Module>State()` helper and chain it BEFORE the parent reset (e.g., `resetAuthState`). Order-dependent test contamination is a real footgun without this. Each new module must do this proactively. As of Module 8, the chain is: `resetWarehouseState → resetCallCenterState → resetInventoryState → resetOrderState → resetCatalogState → (auth/seller wipe)` — warehouse FIRST because `shipment_items.pickedBinId/pickedBatchId` FK `warehouse_bins`/`stock_batches` (else `resetInventoryState` blows the FK); `shipments`/`manifests` FK `staff_users` (SET NULL but explicit clearing keeps suites independent); `order_shipments` FK `orders`. CASCADE on `(shipment_items, awb_labels, order_shipments, shipments, manifests)` handles child ordering.
- Use `makeTestEnv()` from the shared test helpers when constructing `EnvService` in tests; don't inline literal env objects.
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
- Lint stays green at every commit boundary (`--max-warnings 0`). Module 6 surfaced a regression here — a non-null assertion landed in one commit and tripped lint. Always run lint in the verification gates per commit.

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
19. Honor CUR-1 through CUR-9 (Module 9). qtyOnHand decrements EXACTLY ONCE — at DISPATCH, via the `DISPATCH_STOCK` matrix side-effect (CUR-3, Model A); never add another lifecycle decrement. AWB generation is once-only — `shipment.awbNumber` is the gate (CUR-9). Courier credentials decrypt only via `CourierCredentialService` with an audit row per decrypt (CUR-1); the key stays in env, never the DB. The Delhivery wire contract is NOT validated — every real-mode call site is flagged `TODO(delhivery-api)` and throws; build + test against the `DelhiveryClient` adapter in STUB MODE only. Manual placement is conservation-guarded — never dispatch an order with a residual phase-1 reservation (CUR-8).
20. Honor TRK-1 through TRK-9 (Module 10). The scan-status → order-transition mapping lives ONLY in `TrackingStatusMappingService` (TRK-5) — single source of truth, EXHAUSTIVE switch over `ShipmentStatus`, never duplicated; its `allowedFromOrderStatuses` MUST mirror the M9 matrix's inbound edges to `targetOrderStatus` exactly (the F6 / commit-9 bidirectional consistency test pins this). `tracking_events.eventAt` is the SCAN timestamp — all reads + the monotonic-forward guard order by it, never `createdAt` (TRK-3). DELIVERED is STOCK-NEUTRAL — `OUT_FOR_DELIVERY → DELIVERED` matrix edge has `sideEffects:[]` and M10 NEVER reaches back into the stock layer (TRK-7). RTO is webhook-driven up to `RTO_IN_TRANSIT` only — the warehouse `RtoReceiptService.receive()` is the sole authority for `RTO_RECEIVED` (TRK-6); a `RTO_DELIVERED` scan is INFORMATIONAL. The webhook processor saga is delivery_attempts FIRST, tracking_event SECOND, transition LAST (visible-vs-silent); the same shape holds for manual-tracking (TRK-9). Public projection is customer-safe — NO internal IDs, NO PII, NO `isVisibleToCustomer=false` audit scans (TRK-8); the 404 body is generic across all miss reasons (anti-enumeration). Webhook HMAC secret lives in env, referenced by the seeded `tracking.webhook_secret_ref` system_setting (TRK-1 / CUR-1 discipline); the real Delhivery HMAC scheme + the `normalizeScan` raw-code table are NEW `TODO(delhivery-api)` seams joining M9's existing 6 (8 total).
21. Honor NOTIF-1 through NOTIF-8 (Module 11). The order lifecycle fan-out is the 6th post-commit hook in `OrderWriteService.transitionStatus` — emit to the R3 `OrderLifecycleEventBus` (NOTIF-5: the order module never imports `NotificationsModule`); the `NotificationListener` is the SOLE subscriber. The status → fan-out mapping lives ONLY in `NotificationEventMappingService` (NOTIF-4, THIRD single-source-mapping instance after CC-2 / TRK-5) — F2-exhaustive switch over `OrderStatus`, never duplicated. The ledger writes notification_logs FIRST (NOTIF-2 store-then-send, composite-key dedup gate on `(event_id, recipient_type, recipient_id, channel, template_code) WHERE event_id IS NOT NULL`); per-target failures are ISOLATED inside the listener loop (NOTIF-3). Missing recipient address → SKIPPED row, NOT FAILED (NOTIF-8). Listener is best-effort by THREE layers (bus + subscribe wrapper + handle catch) — a listener fault NEVER rolls back the transition (NOTIF-1). NEW lifecycle-event paths MUST set `eventId` (legacy fire-once callers stay on the polymorphic `(templateCode, recipientType, recipientId)` lookup — DO NOT add `eventId` to them without auditing their dedup). When adding ANY future post-commit fire-and-forget side-effect that does async DB work, mirror the M11 listener teardown discipline: track in-flight Promises in a Set, expose `drainInFlight()`, await in `onModuleDestroy()` — the e2e harness's `resetAuthState(prisma, app)` is the canonical drain seam.
22. Honor FE-1 through FE-6 (Module 12 — frontend foundation). The access token NEVER persists to localStorage / sessionStorage / IndexedDB — the in-memory `AccessTokenStore` is the only sanctioned holder (FE-1). UI role-gating is COSMETIC ONLY (FE-2); the server is the security boundary, and when it rejects, surface the `[CODE] message` VERBATIM — DO NOT pre-empt with a client-side mirror of the policy. The browser talks only to its own origin (FE-3); cross-origin browser→API calls are forbidden; the Next.js route-handler proxy at `app/api/[...path]/route.ts` is the sole `/api/*` bridge. Server components authenticate via the `__Host-` cookie → READ-ONLY non-rotating `/me` (FE-4); SSR NEVER calls `/refresh`; use `RefreshTokenService.validateByPlaintext`, NOT `rotate()`. The shared packages (`@skydrop/api-client`, `@skydrop/auth`) are identity-parameterized (FE-5) — staff and seller share mechanics; the IdentityKind is a parameter. Semantic status colors + design tokens live ONLY in `@skydrop/ui` (FE-6); never hardcoded hex; the F2-exhaustive `orderStatusKind`/`shipmentStatusKind` switches make enum drift fail-to-compile. Single-flight refresh in `packages/api-client/src/refresh/single-flight.ts` is load-bearing: N concurrent 401s MUST coalesce to ONE `/refresh` or the API's reuse-detection family-burn fires on a legitimate session. When adding ANY future state-changing admin action, mirror the M12 list→detail→action→audit template: cosmetic RBAC + confirm modal + server-verdict-verbatim surfacing + TanStack query-prefix invalidation on success. Components stay in `apps/admin/src/components/ui` until apps/seller forces extraction — DO NOT prematurely extract; tokens are shared NOW, components are not.

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
| 6 | Order Management (manual entry, CSV upload, lifecycle, events) | ✅ DONE |
| 7 | Call Center Workflow (queue, distributor, attempt logging) | ✅ DONE |
| 8 | Warehouse Operations (pick, pack, dispatch, RTO) | ✅ DONE |
| 9 | Courier Integration (Delhivery API + manual placement workflow) | ✅ DONE |
| 10 | Public Tracking — webhook ingestion + processor + public AWB lookup + manual entry (API layer; EN+HI frontend deferred) | ✅ DONE |
| 11 | Notifications (R3 lifecycle event bus + listener fan-out on top of M1 email substrate; NOTIF-1..8) | ✅ DONE |
| 12 | Admin Dashboard (first frontend; seller mgmt + order ops + god-mode; shared FE foundation; FE-1..6) | ✅ DONE |
| 13 | apps/seller — second consumer of FE foundation; CP1 foundation + CP2 Orders/Catalog pattern-setters | ✅ DONE |
| 14 | System Settings UI | ✅ DONE |
| 15 | Pricing Engine (calculate only, no billing) | ✅ DONE (backend; M6 integration fast-follow) |
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

## Current State (2026-05-29)

**Implemented:**
- Infrastructure (DO droplet, managed Postgres, Spaces, Cloudflare)
- Local dev (WSL2, Docker Postgres + Redis with TimescaleDB)
- Monorepo skeleton (Turborepo + pnpm)
- `@skydrop/db` package: Prisma models across all 9 layers, migrations applied through M11 (M11 added the `notification_logs.event_id` column + the partial-unique `(event_id, recipient_type, recipient_id, channel, template_code) WHERE event_id IS NOT NULL` for NOTIF-2 dedup + `SKIPPED` to `NotificationStatus` enum for NOTIF-8; M12 added NO migrations — the only API change was the hybrid /me cookie path, no schema touched), idempotent seed (system settings, couriers, FX, warehouse, rate card, 25+ notification templates incl. M11's customer-bilingual + missing seller lifecycle templates, M8 warehouse-ops keys, M10 tracking keys)
- `apps/api` (NestJS): config (Zod-validated), Prisma module, Redis module, health endpoints, Swagger at /api/docs, Pino logging with redaction, global exception filter, request-id middleware, rate limiting, multiple BullMQ workers in-process (email, image-thumbnail, image-orphan-cleanup, csv-import-processor, reservation-cleanup, adjustment-executor, order-csv-import, call-assignment-expiration, warehouse-pick-expiration, courier-awb-generation, tracking-webhook-processing)
- **Module 1** — Auth & Access Control
- **Module 2** — Seller Onboarding (also covers Module 3 scope)
- **Module 4** — Product/SKU Catalog: `CatalogReadService` as sanctioned cross-module variant read boundary
- **Module 5** — Inventory & WMS: `StockMutationService` sole writer with version-CAS retry; `StockAvailabilityService` INV-3 canonical scalar; two-path `StockReadService` (live vs cached, INV-2); LATE reservations with phase-1/phase-2 model; goods receipts; threshold-gated adjustments; cycle counts; `StockAlertService` state machine. Cross-module surface (Modules 6, 8): `StockReadService`, `StockReservationService`, `StockPickAllocationService` (+ `StockPickAllocationService.releaseAllocation` added in M8 commit 1 for WMS-5 give-backs). INV-1 through INV-9 codified as non-negotiable invariants.
- **Module 6** — Order Management: 28-status state machine; `OrderService.create()` snapshot pattern; CSV bulk import with state-aware idempotency (ORD-9); `OrderWriteService.transitionStatus()` as sanctioned cross-module write boundary using saga pattern for M5 integration; `OrderReadService` as read boundary; `OrderAdminOverrideService.forceMutate()` god mode with 8 hardened guardrails + `hasAdminOverride` flag set-once-never-cleared; admin sane-cancel + release-reservations endpoints. M8 commit 16 wired `transitionStatus` to `ShipmentProvisionService` (R3 CC-6 dual-path: `provisionFromSnapshot` on entry to CONFIRMED, `voidForOrder` on entry to cancel/reject terminals). ORD-1 through ORD-10 codified as non-negotiable invariants.
- **Module 7** — Call Center Workflow: `call-queue` PRIMITIVE module (R3 — `CallQueueService`, no Order dep, imported by both `order` and `call-center`); `CallAssignmentService.pullNext` strict-FIFO + `FOR UPDATE SKIP LOCKED`; `CallOutcomeMappingService` centralized 9-outcome→transition table (CC-2); `CallAttemptService.recordAttempt` tx-atomic attempt+queue close → post-commit M5/M6 saga + re-queue (CC-3); time-based idempotent `AssignmentExpirationService` + BullMQ; `AgentSettingsService` 10c split; agent + admin endpoints; CC-6 enqueue/dequeue with dual-path idempotent dequeue. CC-1 through CC-7 codified as non-negotiable invariants.
- **Module 8** — Warehouse Operations: four-module split (`warehouse-pick`, `warehouse-pack`, `warehouse-manifest`, `warehouse-rto`) consuming the FOURTH successful R3 primitive (`shipment-provision`, snapshot-DTO refinement). Picker workflow with FOR UPDATE OF s SKIP LOCKED FIFO + claim/start/recordItem/complete saga (WMS-1..5,9); WMS-3 outer retry over M5 allocateAndPopulate; WMS-4 shortfall fail-routing to PENDING_MANUAL_PLACEMENT; WMS-5 time-based idempotent pick expiration (BullMQ) + releaseAllocation give-back; pack workflow virtual-FIFO + race-resolved-at-complete + WMS-7 auto-attach to DRAFT manifest (per-(courier,warehouse) advisory-lock-serialized find-or-create); WMS-6 supervisor manifest close saga; WMS-7 supervisor moveShipment DRAFT↔DRAFT; WMS-8 RTO finalize (reverted to Model A by M9 — see below). WMS-1 through WMS-9 codified as non-negotiable invariants. The conservation e2e (`stock-conservation-rto.e2e-spec`) is a permanent cross-lifecycle regression guard.
- **Module 9** — Courier Integration: built against a `DelhiveryClient` adapter (STUB MODE default; REAL MODE wire seams flagged `TODO(delhivery-api)`). `courier-shared` (`CourierCredentialService` — decrypt-with-audit, AES-256-GCM, key in env); `courier-delhivery` (the adapter — AWB/label/serviceability/http; M10 extended with `normalizeScan` — TRK-5 / F8, fourth capability service); `courier-awb` (`AwbGenerationService` + `AwbSupersedeService` + `AwbGenerationJobService` — the per-manifest BullMQ AWB saga, per-shipment failure isolation, CUR-2/7/9; replaced the M8 AWB stub; M10 commit 1 fixed the CUR-6 label-upload ordering bug — visible-vs-silent applied: AWB persist FIRST, label as retryable Phase D); `courier-dispatch` (`DispatchHandoffService` + `DispatchController` — CUR-4); `courier-manual-placement` (`ManualPlacementService` + endpoints — CUR-8). **bug-1 RESOLVED (Model A)**: the `PENDING_DISPATCH/PENDING_MANUAL_PLACEMENT → DISPATCHED` matrix edges carry `DISPATCH_STOCK` — qtyOnHand decrements EXACTLY ONCE at dispatch (a `DISPATCH` movement per phase-2 reservation + `fulfill()`); DELIVERED is stock-neutral; `RtoDispositionService.finalize()` reverted to Model A (RESTOCK → `RETURN_RESTOCK +qty`; WRITE_OFF → no movement). Conservation verified end-to-end (`stock-conservation-rto` trace: CONFIRMED 10/0 → pick 10/2 → DISPATCHED 8/0 → finalize RESTOCK 10/0 / WRITE_OFF 8/0). CUR-1 through CUR-9 codified as non-negotiable invariants.
- **Module 10** — Public Tracking (API layer): four-module split (`tracking-events`, `tracking-ingestion`, `tracking-public`, `tracking-manual`). `WebhookAuthService` HMAC over raw bytes (TRK-1); `WebhookIngestService` store-then-process with `(courierCode, signature)` dedup (TRK-2); `TrackingWebhookWorker` BullMQ processor (saga: master idempotency + parse + normalize + delivery_attempts FIRST + tracking_event SECOND + monotonic-forward guarded transition LAST + mark PROCESSED — visible-vs-silent throughout). `TrackingStatusMappingService` is the F2-exhaustive single-source mapping (TRK-5); `TrackingEventAppendService` is the TRK-3 append-only writer + eventAt-DESC `latestForShipment` read. F6-reconciled (commit 9): mapping `allowedFromOrderStatuses` mirrors the M9 matrix's inbound edges EXACTLY; a bidirectional consistency test guards drift; the OUT_FOR_DELIVERY allowedFrom fix unblocks the NDR retry cycle (DELIVERY_FAILED → OUT_FOR_DELIVERY) end-to-end. `PublicTrackingReadService` returns the customer-safe projection (TRK-8) — no internal IDs / PII / cross-order data; 12-bucket display status with pre-dispatch internals collapsed to `processing`; 30/min/IP rate limit on the open lookup; generic 404 across all miss reasons. `ManualTrackingService` (TRK-9) reuses the same mapping + guard; `MANUAL_PLACEMENT_ADMIN` / `WAREHOUSE_SUPERVISOR` / `SUPER_ADMIN` controller. TRK-7 stock-neutrality of DELIVERED re-verified at the integration layer (`tracking-flow.e2e-spec.ts` TRK-7 CONSERVATION case: dispatch 8/0 stays 8/0 at DELIVERED, exactly ONE DISPATCH movement). TRK-6 RTO boundary verified end-to-end (webhook drives to RTO_IN_TRANSIT; `RtoReceiptService.receive` is the sole RTO_RECEIVED authority). TRK-1 through TRK-9 codified as non-negotiable invariants. The webhook processor + manual-tracking sagas are the sixth+ applications of the saga + visible-vs-silent pattern. E2E reset hardened (F9): `resetWarehouseState` now explicitly truncates `courier_webhooks` + `tracking_events` + `delivery_attempts` BEFORE shipments (`courier_webhooks.shipment_id` is SET NULL — CASCADE alone leaks state across suites).
- **Module 11** — Notifications (lifecycle fan-out on top of M1's existing email substrate): two-module split — `lifecycle-events` (the R3 #4 primitive, NO deps, NO `forwardRef`) + `notifications` (the listener + ledger + mapping; LEAF consumer — nothing imports it). `OrderLifecycleEventBus` is the rxjs Subject the order module emits to as the 6th post-commit hook in `transitionStatus`; the `NotificationListener` is the bootstrap subscriber. `NotificationEventMappingService` (NOTIF-4) is the THIRD single-source mapping instance after `CallOutcomeMappingService` (CC-2) and `TrackingStatusMappingService` (TRK-5) — same F2-exhaustive switch shape. `NotificationLedgerService` (NOTIF-2/3/8) writes the notification_logs row FIRST then enqueues the existing `EmailQueue` BullMQ job; the composite-key partial-unique `(event_id, recipient_type, recipient_id, channel, template_code) WHERE event_id IS NOT NULL` is the dedup gate. NOTIF-1 best-effort: a listener fault NEVER rolls back the transition (three layers of try/catch — bus emit, subscribe wrapper, handle catch). NOTIF-5: the order module never imports `NotificationsModule`. The seeded 25+ notification_templates were extended in commit 2 with the missing customer-bilingual EN+HI templates + the seller dispatch/delivery/NDR/cancel templates. Two idempotency regimes coexist on `notification_logs` — legacy fire-once callers (pre-M11) use the polymorphic `(templateCode, recipientType, recipientId)` lookup with NO eventId; M11 lifecycle callers set eventId and rely on the partial-unique. E2E suite (`notifications-flow.e2e-spec.ts`, 6 tests) drives a full order from PENDING_CONFIRMATION → DELIVERED and asserts notification_logs rows + `[DEV] Would send email` log lines at every Q5 status. The **commit-10 follow-up fix** drained the listener's in-flight `handle()` promises at `onModuleDestroy()` AND between tests via `drainInFlight()` (called by `resetAuthState(prisma, app)`); pre-fix the leaked listener INSERTs deadlocked the harness's TRUNCATE chain (40P01). NOTIF-1 through NOTIF-8 codified as non-negotiable invariants. The lifecycle-event-bus is the FOURTH R3 successful split (call-queue/shipment-provision/inventory-shared+stock/lifecycle-events).
- **Module 12** — Admin Dashboard + the shared frontend foundation (the FIRST frontend module). Two halves:
  - **Foundation (CP1)**: hybrid bearer-OR-`__Host-`cookie `/auth/{staff,seller}/me` — read-only cookie path via the new `RefreshTokenService.validateByPlaintext` (FE-4: SSR never rotates; distinct from `rotate()` so revoked-row presentation returns `null` instead of firing the family-burn). `@skydrop/ui` design tokens (FE-6, dark-primary + light, 8 semantic kinds covering all 28+16 enum values via F2-exhaustive switches). `@skydrop/api-client` typed same-origin fetch client with single-flight refresh (concurrent-401 → ONE `/refresh`; without this the API's reuse-detection family-burn fires on legitimate sessions — pinned by `client.test.ts` "EXACTLY ONE /refresh fired"). `@skydrop/auth` server (SSR `resolveStaffSsrIdentity`/`resolveSellerSsrIdentity`) + client (`<AuthProvider>`, hooks, `hasStaffRole`). apps/admin Next.js 15 + Tailwind v4 + TanStack Query 5 + Geist; the `/api/[...path]/route.ts` SAME-ORIGIN PROXY (FE-3, evaluates `API_ORIGIN` at request time, streams `Set-Cookie` through unchanged); the (authed) route-group gate that SSR-resolves identity via cookie→/me; dark-utilitarian shell (sidebar + topbar + sign-out). CP1 verified end-to-end with a live 7-step refresh-through-proxy round-trip — `apps/admin/CP1_VERIFICATION.md`.
  - **Features (CP2)**: shared component primitives (status-badge / button / card / data-table / form / modal / page — token-driven, extraction-ready, all under `apps/admin/src/components/ui`); seller management (invitation lifecycle + sellers list/detail + the well-built suspend/reapprove template — RBAC cosmetic to `SUPER_ADMIN`/`SELLER_APPROVAL_ADMIN`); order list with URL-driven filters; order detail; sane admin cancel (matrix-guarded, server-verdict-verbatim); **god-mode override** + release-reservations companion (gravity-escalating chrome: red panel → 22-field whitelist editor → 30-char reason → risk-ack → typed "FORCE-MUTATE" confirm → typed-confirm modal; cosmetic RBAC to `SUPER_ADMIN`; reserveOutcomes surfaced from the server verbatim; the permanent `hasAdminOverride` badge in the order header from this moment forward). The FE-2 boundary is pinned by 7 component tests (`apps/admin/src/tests/*-fe2.test.tsx`) — specifically the "server-rejection VERBATIM" test that proves a `[FORCE_MUTATION_REASON_TOO_SHORT]` from a UI-passing input renders verbatim, not pre-empted. FE-1 through FE-6 codified as non-negotiable invariants.
- **Module 13** — apps/seller (the second consumer of the M12 frontend foundation). Two halves:
  - **Foundation (CP1)** — closed three M12 deferrals: (#2) `@skydrop/ui/components` extraction (7 primitives lifted to `packages/ui/src/components/` with a new `./components` subpath; both apps consume the same surface — extraction shape PROVEN, not just designed for two); (#4) moduleResolution + dist-vs-src discipline verified by a second Next.js consumer at the same tsconfig-paths-to-src pattern; (#5) Playwright harness installed at the workspace root with `admin` (3002) + `seller` (3003) projects + webServer auto-spawn — 6 specs ship (login renders + unauthed-/dashboard-redirect + bad-credentials-FE-2-verbatim, three per project); `pnpm e2e:fe` is the manual smoke gate (not a CI gate yet). Seller-side `RefreshTokenService.validateByPlaintext('seller')` + hybrid `/auth/seller/me` were ALREADY wired in M12 (no backend changes in CP1). apps/seller scaffolding mirrors apps/admin exactly. **FE-5 identity-parameterization PROVEN** in practice: the diff is the IdentityKind parameter and the resulting types (`SellerMe`↔`StaffMe`, `__Host-sellerRefresh`↔`__Host-staffRefresh`, `resolveSellerSsrIdentity`↔`resolveStaffSsrIdentity`); the auth gate, proxy, single-flight refresh, in-memory token store, AuthProvider, useApiClient, FE-2 server-verdict-verbatim discipline are all REUSED UNCHANGED. CP1 verification: `apps/seller/CP1_VERIFICATION.md`.
  - **Features (CP2)** — two pattern-setters. **CP2.A (Orders, read-heavy)**: `/orders` list with URL-driven filters (status + search + page); `/orders/[id]` detail with recipient + payment + physical + items + the **seller-visible lifecycle timeline** (via `/seller/orders/:id/events`, server-filtered to `isVisibleToSeller=true` per M6); dashboard surfaces the latest-5 Recent Orders card. **The CP2.A.1 backend fix closes the M11 ndr_reason phase-1a-debt entry**: `NotificationListener.loadOrderContext` now fetches the latest `delivery_attempts` row per live shipment and humanizes `failureReason` (the enum `CUSTOMER_PHONE_UNREACHABLE` → `'Customer Phone Unreachable'`) into the `ndr_reason` template variable, with `failureNotes` fallback and empty-string fallback. Pinned by 3 new unit tests (`notification-listener.service.spec.ts` "DELIVERY_FAILED — ndr_reason surfaces ..."). The M12 deferral #1's admin order-detail timeline half remains open as a small follow-up — the seller half is closed via the existing `/seller/orders/:id/events` endpoint with no schema/backend changes beyond ndr_reason. **CP2.B (Catalog, write-heavy)**: `/catalog` list at product grain (backend serves /seller/products paginated; variants live per-product, so flat variant view would need a new endpoint — pragmatic resolution: product grain at the list, variant grain at the product detail); `/catalog/products/[id]` with inline edit (no separate /edit route); `/catalog/products/[id]/variants/[variantId]` with inline edit (SKU immutable, displayed disabled with "Immutable" hint) + **drag-drop multi image upload UX** — MAX_UPLOAD_BATCH=5, sequential presign → PUT to S3 directly (raw fetch, not via ApiClient — the presigned URL is to Spaces, not our origin) → POST /seller/images to register; in-row status badges (queued/uploading/registering/done/error) using FE-6 StatusBadge kinds; client-side JPG/PNG/WEBP type gate is UX (server still validates); FE-2: on error, `[code] message` surfaces VERBATIM from ApiError.body. The CP2 manual smoke procedure is `apps/seller/CP2_FEATURE_SMOKE.md`.
- **Module 14** — System Settings UI. The `SystemSetting` model has been in the schema since M0 (consumed by call-center caps, pricing GST, stock TTLs, courier defaults — ~30 seeded keys across `ops` / `pricing` / `notifications` / `webhooks` / `courier` / `tracking` categories); M14 surfaces the WRITE side to admin tooling. Backend: `system-settings` module — `SystemSettingsService` (list grouped by category, getByKey with raw value for edit, updateValue with type-aware writes + audit + lastEditedBy/At tracking); `AdminSystemSettingsController` (GET / GET:key / PATCH:key). Invariants: (a) type-aware writes — service writes ONLY the matching `value_*` column and nulls the others atomically (Phase-2-future type conversions never leave orphan values); (b) `isEditableByAdmin` gates the WRITE path (409 NOT_EDITABLE + LOW audit on reject); (c) DTO `valueType` must match the row's `valueType` (400 VALUE_TYPE_MISMATCH); (d) `parseValue` rejects malformed inputs per type (400 INVALID_VALUE); (e) successful writes audit MEDIUM `staff.system_setting.updated` with before/after; (f) sensitive settings — list returns `valueDisplay='***'`, getByKey returns raw value (UI gates reveal-on-intent). Frontend: admin `/settings` page grouped by category; type-aware edit modal (STRING/INT/DECIMAL → text + client parse; BOOLEAN → checkbox; JSON → textarea with JSON.parse + object/array check; DATE → datetime-local with ISO normalization); sensitive-reveal Eye-icon toggle; **FE-2 verbatim** on server validation errors. Tests: 10 unit (SystemSettingsService.spec — list grouping + sensitive masking, updateValue 7 type-aware + reject cases, getByKey raw value pass-through). NOT IN SCOPE (Phase 1A): JSON-schema validation via `validationSchema` (column present, deep schema validation deferred); a `system_setting_edits` history table (the audit trail IS the history).
- **Module 15** — Pricing Engine (calculate only, no billing). Phase 1A is BACKEND ONLY: the engine + admin preview endpoint; M6 order-create integration (auto-compute + persist into `order_charges` at order create) is a documented fast-follow. The schema's pricing layer (RateCard, RateCardItem, SellerPricing, SurchargeRule, ZoneMatrixEntry, OrderCharge, PinCode) has been in place since M0; M15 wires the calculator on top. `PricingEngineService.compute()`: (1) resolve rate card (SellerPricing → default RateCard, both effective-dated); (2) resolve courier + service type (`ops.default_courier_code` fallback); (3) resolve zone via `ZoneResolverService` (PIN → ServiceArea → ZoneMatrixEntry per courier; falls back to PIN's own zone, then to literal "DEFAULT"); (4) actual chargeable weight (volumetric deferred); (5) look up `RateCardItem` matching `(rateCard, courier, serviceType, zone, weightSlab)`; missing slab → 0 base + `NO_RATE_CARD_ITEM` flag; (6) apply `SellerPricing.discountPercent`; (7) apply `SurchargeRule`s filtered by `paymentMode` + `serviceArea`, computing FLAT / PERCENTAGE (with min/max clamps + `baseField` selector — SHIPPING_CHARGE/COD_AMOUNT/DECLARED_VALUE/CHARGEABLE_WEIGHT); TIERED returns 0 + flag (deferred); honors `SellerPricing.codFeePercent` on COD orders even without an explicit rule; (8) GST as a separate line — 18% (or `pricing.gst_rate`) of `(baseShipping + sum(surcharges))` per CLAUDE pricing rule. Returns `PricingComputeOutput` with structured lines + `computationContext` JSON ready for `OrderCharge.computationContext` persistence + `UnresolvedFallback[]` flags (so the admin preview surfaces missing seed data — `NO_RATE_CARD`, `NO_RATE_CARD_ITEM`, `ZONE_FALLBACK_DEFAULT`, `NO_COURIER`, `NO_GST_RATE`, `TIERED_SURCHARGE_NOT_IMPLEMENTED`). Admin preview endpoint: `POST /admin/pricing/preview`. Tests: 9 unit (PricingEngineService.compute — missing-data fallbacks, end-to-end base+surcharge+GST, seller discount, seller COD fee, PERCENTAGE clamps, payment-mode + service-area filters, perKgChargeInr above slab floor, NO_RATE_CARD when bare, INVALID_WEIGHT reject).
- Test totals: **981 unit (API)** (972 + 9 pricing-engine) + **99 e2e (API)** + **26 vitest (packages: api-client 16 + auth 10)** + **7 vitest (admin FE-2 boundary)** + **3 vitest (seller order-timeline smoke)** + **6 Playwright specs** (M13 CP1.7, manual smoke — admin login 3 + seller login 3), all green where exercised. CP1 + CP2 verification docs: `apps/admin/CP1_VERIFICATION.md` + `apps/admin/CP2_FEATURE_SMOKE.md` + `apps/seller/CP1_VERIFICATION.md` + `apps/seller/CP2_FEATURE_SMOKE.md`.

**Not yet implemented:**
- Other frontends (`apps/track`, `apps/marketing`, `apps/workers`) — placeholders.
- Modules 16-18.
- Reports (the original M13 slot — pushed to a later cycle since apps/seller took the M13 fork at the design phase).
- **M15 fast-follow**: integrate `PricingEngineService.compute()` into `OrderService.create()` — append to the create tx, persist breakdown into `order_charges` (one row per line + GST), set `OrderCharge.status = ESTIMATED`. Admin order detail UI can then surface charges (M17 territory).

**Next:** Module 14 (System Settings UI) OR a Reports-shaped backend cycle OR M13 fast-follows. M13 left a focused set of fast-follows: (1) **manual order create UI** (M6 backend supports it — `POST /seller/orders`; the seller-side form is a fast-follow); (2) **CSV order/product import UI** (both backends exist; multi-state upload UI is fast-follow); (3) **seller inventory view** (`/inventory` tab; M5 backend supports per-seller stock reads); (4) **tracking deep-link on order detail** (the AWB lives on the shipment, not OrderView — either expand the view or surface a separate Track action when DISPATCHED+); (5) **admin order-detail events endpoint** (the other half of M12 deferral #1 — admin `GET /admin/orders/:id/events` paralleling the seller one); (6) **warehouse-ops + queue-management admin feature areas** (M12 deferral #3, no architectural blockers — feature scope only); (7) **explicit seller-side FE-2 write tests** (the discipline is structurally enforced + admin-side proves the pattern; explicit tests are a focused follow-up). M11/M10 follow-ups remain open (legacy fire-once vs lifecycle composite-key idempotency regimes; in-process bus → Phase-2 Redis pub/sub; Delhivery wire seams x8; etc.).

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
- **Pre-flight reviews catch real problems.** Modules 4-6 surfaced multiple findings pre-implementation (FK constraints, alert grain mismatch, adjustment intent gap, refactor circular dep, tx-boundary conflict with M5). When Claude Code proposes a plan, scrutinize it before approval.
- **After a crash or environment loss**, recovery is straightforward: `git log` shows what landed; `git status` shows uncommitted state; push any unpushed commits first; verify gates green; then resume from the appropriate checkpoint. Working tree is the source of truth, not session memory.
