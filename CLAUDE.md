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

**Migrations applied:** As of Module 6 — order schema additions (hasAdminOverride, CANCELLED_BY_ADMIN, OUT_OF_STOCK, per-seller customer constraint).

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

### Saga: visible-vs-silent failure ordering (generalizable rule)

When a saga cannot be one Postgres transaction (because a cross-module service owns its own tx — M5 reservations, `OrderWriteService.transitionStatus`, etc.), **order the steps so an orphaned intermediate state is SELF-ANNOUNCING (visible, recoverable), never silent.** The source-of-truth side-effect goes FIRST and durable; the dependent reflection goes LAST; the whole thing is idempotent on retry.

The principle, generalized: ask "if we crash between step N and step N+1, does the next caller's view of the world correctly tell them what happened?" If yes (a half-finalized order in `RTO_RECEIVED` says "movements applied, transition pending — retry me" via the gate-2 query), the ordering is correct. If no (an order showing `RTO_RESTOCKED` while stock is silently missing — Option B from the WMS-8 pre-fix discussion), the ordering is INVERTED — flip it.

Canonical applications:
- **WMS-8 RTO finalize**: releases + WRITE_OFF movements FIRST, transition LAST. A crash after movements leaves order in `RTO_RECEIVED` (visible, recoverable); a crash before movements rolls back atomically.
- **PickExecutionService.complete / PackService.complete**: operational stamp (shipment.pickCompletedAt / packCompletedAt) FIRST (guarded `updateMany` idempotent), authoritative transition LAST. A crash after stamp leaves a re-callable PENDING_PICK / PICKED with the original timestamp preserved.
- **RtoReceiptService.receive**: stamp `rtoReceivedAt` FIRST, transition LAST. Same shape.
- **M6 saga (ORD-3)**: RESERVE pre-tx (fail-routing to OUT_OF_STOCK is the visible alternative); RELEASE/FULFILL post-commit idempotent.

**This pattern will recur in M9 (AWB generation saga).** When designing any future saga: write down the cross-module step that owns its own tx, identify the local state-of-truth, put the durable side-effect FIRST, and verify the intermediate-state retry-convergence story before coding. The CP1 pre-flight review pattern is the enforcement mechanism (the WMS-8 conservation bug demonstrated that even with this principle understood, a leg-by-leg unit test can pass while a full-lifecycle conservation e2e catches the real issue — keep the cross-lifecycle invariant tests).

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
| 9 | Courier Integration (Delhivery API + manual placement workflow) | NEXT |
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

## Current State (2026-05-21)

**Implemented:**
- Infrastructure (DO droplet, managed Postgres, Spaces, Cloudflare)
- Local dev (WSL2, Docker Postgres + Redis with TimescaleDB)
- Monorepo skeleton (Turborepo + pnpm)
- `@skydrop/db` package: Prisma models across all 9 layers, multiple migrations, idempotent seed (system settings, couriers, FX, warehouse, rate card, 25+ notification templates, M8 warehouse-ops keys)
- `apps/api` (NestJS): config (Zod-validated), Prisma module, Redis module, health endpoints, Swagger at /api/docs, Pino logging with redaction, global exception filter, request-id middleware, rate limiting, multiple BullMQ workers in-process (email, image-thumbnail, image-orphan-cleanup, csv-import-processor, reservation-cleanup, adjustment-executor, order-csv-import, call-assignment-expiration, warehouse-pick-expiration)
- **Module 1** — Auth & Access Control
- **Module 2** — Seller Onboarding (also covers Module 3 scope)
- **Module 4** — Product/SKU Catalog: `CatalogReadService` as sanctioned cross-module variant read boundary
- **Module 5** — Inventory & WMS: `StockMutationService` sole writer with version-CAS retry; `StockAvailabilityService` INV-3 canonical scalar; two-path `StockReadService` (live vs cached, INV-2); LATE reservations with phase-1/phase-2 model; goods receipts; threshold-gated adjustments; cycle counts; `StockAlertService` state machine. Cross-module surface (Modules 6, 8): `StockReadService`, `StockReservationService`, `StockPickAllocationService` (+ `StockPickAllocationService.releaseAllocation` added in M8 commit 1 for WMS-5 give-backs). INV-1 through INV-9 codified as non-negotiable invariants.
- **Module 6** — Order Management: 28-status state machine; `OrderService.create()` snapshot pattern; CSV bulk import with state-aware idempotency (ORD-9); `OrderWriteService.transitionStatus()` as sanctioned cross-module write boundary using saga pattern for M5 integration; `OrderReadService` as read boundary; `OrderAdminOverrideService.forceMutate()` god mode with 8 hardened guardrails + `hasAdminOverride` flag set-once-never-cleared; admin sane-cancel + release-reservations endpoints. M8 commit 16 wired `transitionStatus` to `ShipmentProvisionService` (R3 CC-6 dual-path: `provisionFromSnapshot` on entry to CONFIRMED, `voidForOrder` on entry to cancel/reject terminals). ORD-1 through ORD-10 codified as non-negotiable invariants.
- **Module 7** — Call Center Workflow: `call-queue` PRIMITIVE module (R3 — `CallQueueService`, no Order dep, imported by both `order` and `call-center`); `CallAssignmentService.pullNext` strict-FIFO + `FOR UPDATE SKIP LOCKED`; `CallOutcomeMappingService` centralized 9-outcome→transition table (CC-2); `CallAttemptService.recordAttempt` tx-atomic attempt+queue close → post-commit M5/M6 saga + re-queue (CC-3); time-based idempotent `AssignmentExpirationService` + BullMQ; `AgentSettingsService` 10c split; agent + admin endpoints; CC-6 enqueue/dequeue with dual-path idempotent dequeue. CC-1 through CC-7 codified as non-negotiable invariants.
- **Module 8** — Warehouse Operations: four-module split (`warehouse-pick`, `warehouse-pack`, `warehouse-manifest`, `warehouse-rto`) consuming the FOURTH successful R3 primitive (`shipment-provision`, snapshot-DTO refinement). Picker workflow with FOR UPDATE OF s SKIP LOCKED FIFO + claim/start/recordItem/complete saga (WMS-1..5,9); WMS-3 outer retry over M5 allocateAndPopulate; WMS-4 shortfall fail-routing to PENDING_MANUAL_PLACEMENT; WMS-5 time-based idempotent pick expiration (BullMQ) + releaseAllocation give-back; pack workflow virtual-FIFO + race-resolved-at-complete + WMS-7 auto-attach to DRAFT manifest (per-(courier,warehouse) advisory-lock-serialized find-or-create); WMS-6 supervisor manifest close saga + M9 AWB enqueue stub (audit HIGH); WMS-7 supervisor moveShipment DRAFT↔DRAFT; WMS-8 RTO finalize as release-based two-gate saga (visible-vs-silent failure ordering — CORRECTED FROM ORIGINAL RETURN_RESTOCK DESIGN via the full-lifecycle conservation e2e, see phase-1a-debt bug-1 HIGH entry for the latent qtyOnHand-decrement-timing question that couples to this). WMS-1 through WMS-9 codified as non-negotiable invariants. The CP3 conservation e2e (`stock-conservation-rto.e2e-spec`) is a permanent cross-lifecycle regression guard.
- Test totals: 679 unit + 59 e2e tests, all green; fresh-clone simulation verified.

**Not yet implemented:**
- All other apps (frontends in `apps/marketing`, `apps/seller`, `apps/admin`, `apps/track` are placeholders)
- Modules 9-18

**Next:** Module 9 — Courier Integration (Delhivery API + manual placement workflow). **FIRST AGENDA ITEM**: resolve the latent HIGH-priority bug from phase-1a-debt — `stock_levels.qtyOnHand` is never decremented in the normal lifecycle (no `PICK`/`PACK_CONFIRM`/`DISPATCH` movement is issued anywhere). M9 must pick the decrement-timing model: Model A (at-dispatch — qtyOnHand reflects physical shelf) or Model B (at-permanent-departure — current finalize() RESTOCK release-based correct under B). **Under Model A, `RtoDispositionService.finalize()` RESTOCK path MUST be revisited (`RETURN_RESTOCK` becomes correct again).** The break-on-regression assertion in `stock-conservation-rto.e2e-spec` (currently codifying the latent state) flips the moment M9 resolves this. M9 design conversation begins with this decision. **Apply the R3 + saga + visible-vs-silent failure-ordering patterns; the AWB generation saga will be the fifth canonical application.**

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
