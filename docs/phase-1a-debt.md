# Phase 1A Debt

Tracking explicit deferrals from the original module specs. Each entry names
the gap, why we deferred it, and where (which later module) we expect to
pick it up.

---

## Auth module (Module 1)

- **RBAC enforcement on staff endpoints**. Currently any authenticated
  staff member can access `/admin/seller-invitations` and its variants.
  Per the original spec these should be scoped to
  `SUPER_ADMIN` + `SELLER_APPROVAL_ADMIN` via a `@StaffAuth(...)` decorator
  (or equivalent). Deferred because designing the full role/action matrix
  across all 18 modules is non-trivial and the staff base currently
  consists of one super-admin in dev.
  **Pick up:** Module 12 (Admin Dashboard) or earlier if multi-role staff
  is added before that.

- **Notification template variable schema validation**. The
  `notification_templates.variables` JSON column is present and persisted
  but not yet enforced. The `EmailDispatchService` doesn't validate the
  variables passed in against any declared shape. Deferred because no
  template currently declares a `variables` schema and the first ones to
  do so will land with Phase 1B's remittance flows.
  **Pick up:** Module 11 (Notifications) when templates with strict
  variable contracts arrive, or when the first regression bites.

- **BullMQ worker living inside the API process**. Phase 1A wires the
  email worker via `OnModuleInit` inside `apps/api`. Long-term it should
  move to `apps/workers` so the API can scale horizontally without
  duplicating worker capacity. Deferred to keep the auth-module commit
  unit small.
  **Pick up:** Module 11 (Notifications) when other workers — outbound
  webhooks, RTO reconciliation, etc. — make the split worthwhile.

- **Click-to-call integration**. Twilio integration for call agents is
  out of scope for Phase 1A per the original module roadmap. Call
  attempts are logged manually for now.
  **Pick up:** Phase 2.

- **Notification template versioning UX**. We persist `templateVersion`
  on `notification_logs` (so old messages can be re-rendered against
  their original template version) but there's no admin UI to manage
  versions yet.
  **Pick up:** Module 14 (System Settings UI).

---

## Seller onboarding & admin (Module 2)

- **Welcome-email enqueue is outside the registration transaction.**
  `SellerAuthService.registerViaInvitation()` enqueues
  `seller.welcome.email` after the registration `prisma.$transaction`
  commits (with a try/catch swallowing failures). Module 2 introduced
  the inside-tx pattern for suspension, reapproval, and onboarding-
  complete emails so enqueue failure rolls back the DB. The welcome
  enqueue should be harmonized with that pattern for consistency.
  **Pick up:** at the next touch of seller-auth, or whenever the auth
  module is otherwise refactored.

- **RBAC enforcement on `/admin/sellers/*`.** Currently any
  authenticated staff member can list sellers, suspend/reapprove,
  manage notes, and override onboarding steps. Per the original Module
  2 spec, status changes and note edits should be scoped (likely
  `SUPER_ADMIN` + `SELLER_APPROVAL_ADMIN`; CSR roles read-only). Same
  underlying gap as the seller-invitations RBAC debt above.
  **Pick up:** Module 12 (Admin Dashboard) with the wider RBAC roll-out.

- **Note authorship not enforced on edit/delete.** `PATCH` and `DELETE`
  on `/admin/sellers/:id/notes/:noteId` accept any staff member, not
  just the original author. The Module 2 spec explicitly called this
  out as covered by the broader RBAC tightening.
  **Pick up:** alongside the RBAC roll-out above.

- **Onboarding-complete fire-once relies on `notification_logs`.** The
  fire-once check looks for a `notification_log` row with
  `templateCode = "seller.onboarding_complete.email"` and `recipientId
  = sellerId`. If the email worker fails to write the log row (e.g.,
  DB unavailable) but the email actually went out, a future re-trigger
  could double-send. Practical risk is low — the worker writes the log
  row in the same operation as the send — but a notification-level
  dedup key would make this airtight.
  **Pick up:** Module 11 (Notifications), when worker idempotency keys
  land.

---

## Catalog (Module 4)

- **Attribute-cache invalidation is best-effort, not event-driven.**
  `AttributeResolutionService` caches a category's effective attribute
  set in Redis (5-min TTL) and, on any attribute-def write, `DEL`s that
  category plus every descendant. The `DEL` is fire-and-forget — if Redis
  is briefly unavailable the stale set serves until TTL. An event-bus
  (or write-through) invalidation would make it airtight and also let
  other API instances invalidate. Deferred to keep Module 4 in-process.
  **Pick up:** Module 11/with the worker split, or when multi-instance
  API deployment lands.

- **Image MIME is trusted, not sniffed.** Presign/register validate the
  client-declared `mimeType` against an allowlist and HEAD-verify object
  size, but the bytes are never content-sniffed. A seller could upload
  non-image bytes under an `image/png` key. Low risk (private bucket,
  per-seller key prefix, thumbnailer would fail), but real validation
  needs magic-byte sniffing.
  **Pick up:** when image rendering is exposed publicly, or alongside the
  thumbnail worker hardening.

- **No hard-delete cron for soft-deleted products/images.** Soft-deleted
  `products`/`product_images` rows (and their Spaces originals) are never
  reclaimed. The orphan-sweep cron only removes Spaces objects with no
  DB row at all; a soft-deleted-row's object is "known" and kept.
  **Pick up:** Phase 2 (a retention/GC cron once volume justifies it).

- **CSV worker has no crash-resume.** `CsvImportProcessorService` is
  terminal-state idempotent (a re-delivered job for a COMPLETED upload
  no-ops) and per-row transactional, but a worker crash mid-run leaves
  the upload `PROCESSING`; BullMQ retry re-runs from row 1 (already-
  imported rows are skipped via the PATCH-diff dedup, so it's correct
  but not resumable). A checkpoint cursor would make large imports
  resume in place.
  **Pick up:** Module 11/worker split, or when CSV sizes outgrow the
  1000-row Phase 1A cap.

- **Attribute-def delete warns but does not enforce.** Deleting a
  category attribute definition returns a soft `warning` with the count
  of products in that category, but does not block deletion or rewrite
  existing variant `attributes` JSON. A deleted-then-unknown key only
  surfaces on the variant's next validation.
  **Pick up:** Module 12 (admin tooling) if a hard guard is wanted.

- **No product-level attribute proposal flow.** Sellers propose
  *categories* (with attribute defs) for admin approval, but cannot
  propose adding an attribute to an *existing* category. They must file
  a new proposal or ask an admin directly.
  **Pick up:** Module 12 or a later catalog iteration if seller demand
  appears.

- **Image keys use uuidv4, not uuidv7.** All DB ids are `uuidv7()`
  (time-sortable). The Spaces object key's random segment uses uuidv4
  (`buildOriginalKey`) — it only needs uniqueness, not ordering, and the
  DB row id remains uuidv7. Cosmetic inconsistency only.
  **Pick up:** never required; revisit only if keys ever need ordering.

- **GST is whole-percent only.** `defaultGstRate`/`gstRate` inputs and
  the `pricing.gst_rate` system default are validated/treated as
  integers (India GST is integral: 5/12/18/28). The columns are
  `Decimal(5,2)` so fractional rates are storable, but not accepted via
  the API and documented in OpenAPI as "whole percent". `CatalogRead
  Service` surfaces whatever is stored without truncating.
  **Pick up:** Module 15 (Pricing Engine) if a fractional rate is ever
  required.

- **CSV attribute cells are string-or-JSON only.** `coerceRow` parses
  the attributes column as either `key=value;key=value` (all string
  values) or a JSON object (typed values). There is no per-column
  typed-attribute mapping; numeric/boolean attributes need JSON form.
  **Pick up:** later catalog iteration if sellers ask for typed columns.

- **`CatalogReadService` is the only sanctioned cross-module read.**
  Other domains (orders, pricing, shipments, WMS) MUST read variants via
  `CatalogReadService` so property-inheritance precedence lives in one
  place. This is a *convention*, not a compile-time boundary — nothing
  stops a future module from querying `product_variant` directly.
  **Pick up:** enforce via lint/architecture test if drift appears.

---

## Inventory & WMS (Module 5)

- **Phase-1 reservation over-claim window.** `reserve()`'s availability
  check is best-effort under READ COMMITTED with no lock (inherent to the
  locked LATE-allocation design). Two racing reservers can transiently
  over-claim. The HARD physical guard is phase-2 allocation
  (`allocateAndPopulate`, version-CAS on `stock_levels`), which can never
  allocate beyond on-hand. Module 8 owns operational escalation of a
  persistent shortfall (residual phase-1 rows).
  **Pick up:** Module 8 (warehouse ops) for the escalation UX; revisit
  the soft-claim race only if it bites at scale.

- **Movement ledger uses offset pagination + COUNT.** Fine at Phase 1A
  volume; on a large hypertable a `COUNT(*)` over a filtered window and
  deep `OFFSET` degrade.
  **Pick up:** cursor (keyset) pagination when ledger volume warrants.

- **Alert cooldown is a single global value.** `ops.stock_alert_cooldown
  _hours` applies to all sellers/SKUs uniformly.
  **Pick up:** per-seller (or per-category) cooldown config later.

- **Cycle-count reconciliation = one adjustment per discrepancy.** Each
  discrepant item generates its own single-line PENDING `CYCLE_COUNT`
  adjustment; no batched/bulk reconciliation review.
  **Pick up:** a batch-reconciliation UI when count volume justifies it.

- **Discrepancy resolution is correct-or-force-complete.** A DISCREPANCY
  receipt is resolved either by correcting the actuals or force-completing
  with a permanent note; there is no partial-acceptance-with-split
  (accept some lines, re-receive others).
  **Pick up:** partial acceptance + split when ops asks for it.

- **Reservation auto-release worker uses a simple global cron.** Hourly
  `'0 * * * *'` sweep for all sellers; per-seller scheduling/cadence is
  not configurable (the per-seller TTL *is* honored via `expiresAt`).
  **Pick up:** per-seller scheduling if needed.

- **Cache invalidation is centralized but not transactional with DB
  writes.** Invalidation + alert evaluation run AFTER `tx.commit()`
  (INV-5); a crash between commit and invalidation serves a stale display
  cache until the 5-min TTL. Never corrupts stock (mutation paths read
  live, INV-2).
  **Pick up:** outbox/event-sourced invalidation if multi-instance API or
  scale demands airtight cache coherence.

- **`StockAdjustment` shipped without intent persistence.** The base
  schema had no per-target columns; `stock_adjustment_lines` was added in
  Module 5 commit 19 to support the above-threshold approval workflow.
  Single-line (cycle-count) and multi-line (manual) adjustments share the
  model.
  **Pick up:** done — recorded for provenance.

- **Inventory-owned column on a catalog table.** `product_variants.low
  _stock_threshold` is inventory-domain data physically on the variant
  row (storage convenience). Reads go via `CatalogReadService` (raw
  passthrough — MUST #13 intact); the write is a narrow inventory-owned
  update with an explicit code comment. If more inventory-owned per-
  variant columns emerge, extract them to a dedicated
  `variant_inventory_config` table.
  **Pick up:** when a 2nd such column appears.

- **`CatalogReadService` expansion-by-need.** Module 5 added a
  `lowStockThreshold` passthrough to `ResolvedVariant` purely so the
  cross-module read boundary stays the only path to variant data. Expect
  this expand-the-boundary-when-a-consumer-needs-a-field pattern to recur
  in later modules (pricing, shipments).
  **Pick up:** ongoing convention; revisit if the DTO grows unwieldy.

---

## Orders (Module 6)

- **Status-change rule #1 deviation — stock side-effect is a SAGA, not
  one ACID tx.** CLAUDE status-change rule #1 wants the status update and
  its side-effects in a single `prisma.$transaction`. `OrderWriteService
  .transitionStatus()` cannot comply for the *stock* side-effect:
  Module 5's `StockReservationService.reserve/release/fulfill` own their
  own version-CAS retry transaction (INV-1/INV-6) and expose no
  tx-accepting API — a version-CAS retry loop cannot run inside an outer
  tx. So the stock op sits OUTSIDE the order tx (user-approved design):
  RESERVE_STOCK runs BEFORE the status tx (failure → OUT_OF_STOCK when
  the matrix allows, else 409 with no status change; status-tx failure
  after a successful reserve triggers a compensating `release()`);
  RELEASE/FULFILL run AFTER `tx.commit()`, idempotent, exactly mirroring
  INV-5 (cache/alert AFTER commit). The order DB write + its events +
  audit remain atomic together. Reconciliation backstop for the
  unavoidable saga window: M5 reservation `expiresAt` TTL + the hourly
  auto-release worker, plus `release/fulfill` no-op idempotency.
  **Pick up:** revisit only if M5 ever exposes a tx-enrollable
  reservation API, or if the saga window bites operationally (Module 8
  owns the persistent-shortfall escalation UX per the M5 debt entry).

- **Email enqueue not wired in `transitionStatus()`.** Status-change
  rule #2 (email enqueue inside the tx) is not yet honored — order
  status-change notifications are deferred to Module 11 (notification
  dispatch). The `seller.order_status_changed.email` template is seeded
  but nothing enqueues it on transition yet.
  **Pick up:** Module 11.

- **Sanctioned boundary expansions (expand-by-need).** Three additive
  cross-module reads were added so Module 6 never queries another
  domain's tables directly (CLAUDE MUST #13/#15), same precedent as the
  Module-5 `CatalogReadService` note: `CatalogReadService` +=
  `productName`/`imageUrl` (commit 9, order-item snapshot) and
  `getVariantBySku` (commit 19, CSV SKU→variant);
  `StockReservationService.listActiveForOrder` (commit 12, release/
  fulfill targeting). All read-only.
  **Pick up:** ongoing convention; revisit if either cross-module
  surface grows unwieldy.

- **Customer identity narrowed GLOBAL → per-seller.** The pre-M6
  canonical design was a GLOBAL phone-keyed `customers` row with
  cross-seller risk aggregation (`rtoCount`/`fakeOrdersCount`/
  `riskLevel` shared across sellers). Module 6 commit 1 deliberately
  reversed this to `@@unique([sellerId, phoneE164])` for Phase 1A
  privacy; risk aggregates are now per-seller. Cross-seller risk
  aggregation (a fraud signal that would let one seller benefit from
  another's RTO/fake history) is therefore NOT available.
  **Pick up:** Phase 1B/2 fraud work — reintroduce a cross-seller risk
  view (likely a separate aggregate keyed by phone, computed read-side,
  not by re-globalizing the `customers` row).

- **CSV order imports are single-line only.** CSV order imports support
  one row → one order with single line item only. Multi-line orders
  (multiple SKUs in one order) require manual entry via
  `POST /seller/orders`. Phase 2 work: parent-row grouping logic for
  multi-line CSV imports.
  **Pick up:** Phase 2.

- **Cross-module facade is convention, not compile-time.** `OrderModule`
  exports exactly `OrderReadService` + `OrderWriteService`; the rest
  live in the internal `OrderCoreModule` (consumed only by Module-6
  controllers + `order-csv-import`). NestJS enforces the module export
  list, but nothing stops a future module from importing
  `OrderCoreModule` directly — same convention-not-lint caveat as the
  `CatalogReadService` entry above.
  **Pick up:** enforce via an architecture/lint test if drift appears.

- **God mode opts OUT of the saga compensation guarantee.**
  `OrderAdminOverrideService.forceMutate()` attempts reserve on a
  → CONFIRMED bypass but NEVER blocks or compensates on failure (the
  admin acknowledged the risk); transitioning away from CONFIRMED
  leaves reservations intact (cleanup is the separate
  `release-reservations` endpoint). `hasAdminOverride` is set-once,
  never cleared. This is intentional, not a defect — recorded so future
  readers don't "fix" it.
  **Pick up:** never (documented design).

## Call Center (Module 7)

- **Partial unique index is migration-managed, not in schema.prisma.**
  `call_queue_entries_open_order_uq` (`ON (order_id) WHERE status IN
  ('pending','assigned')`) enforces "at most one OPEN queue entry per
  order" while allowing the locked-decision-#2 re-queue history. Prisma
  cannot declare a filtered/partial unique index, so the migration
  `20260518061351_call_queue_open_order_partial_unique` is the source of
  truth (the hard `@unique` on `orderId` was dropped; `@@index([orderId])`
  remains). Schema-introspection drift is suppressed by the
  hand-authored `migrate diff` + `migrate deploy` workflow established in
  commit 1 (we do NOT run interactive `migrate dev`).
  **Pick up:** when upgrading Prisma, verify this index survives schema
  regeneration / `db pull`; re-assert it in a migration if a Prisma
  version ever drops unknown indexes on `migrate diff`.

- **`QueueClosureReason` is imprecise for re-queued / transient closes.**
  The enum (`ORDER_CONFIRMED`, `ORDER_CANCELLED`, `ORDER_REJECTED`,
  `MAX_ATTEMPTS_EXCEEDED`, `ORDER_DELETED`, `ADMIN_CLOSED`) has no value
  for "this entry was SUPERSEDED by a re-queue / the order left for a
  transient non-terminal state (OUT_OF_STOCK) and will re-enqueue".
  `CallAttemptService` leaves the (nullable) `closureReason` NULL for
  requeue/non-terminal closes; `OrderWriteService.dequeueForExit` uses
  `ADMIN_CLOSED` as the neutral fallback (its `dequeueOrder` arg is
  non-null). This is secondary metadata only — the authoritative history
  is the append-only `call_attempts` + `order_events` (CC-3).
  **Pick up:** add a `SUPERSEDED` (or `REQUEUED`) `QueueClosureReason`
  value in a later module and replace both fallbacks; backfill is
  unnecessary (closed rows are immutable history).

- **Legacy `ops.call_max_attempts` system setting is deprecated.**
  Module 7 introduced `ops.call_max_attempts_before_ndr` (default 3) as
  the NDR cap; the pre-existing `ops.call_max_attempts` is now dead
  config and is read by nothing. Left in the seed untouched to avoid a
  mid-module data change. **Pick up:** remove the key in a settings-
  cleanup migration (or when Module 14's System Settings UI lands).

- **Queue distribution is strict FIFO (locked decision #1).**
  `ORDER BY available_at ASC, created_at ASC`. Round-robin /
  priority-weighting / language-match / skill-based routing are
  deferred — Phase-1A scale does not need them, and the `priority`,
  `previousAgentIds`, `assignmentMethod` columns are intentionally
  unwired (forward-compatible). **Pick up:** when call volume justifies
  it, layer a distributor over `pullNext` (the FIFO SELECT is the seam).

- **Agent available-hours are advisory only (locked decision 10b).**
  `agent_call_settings` working hours / days / timezone are stored and
  surfaced but NOT enforced anywhere (`pullNext` ignores them). **Pick
  up:** enforce in the distributor when routing graduates beyond FIFO.

- **Per-seller + time-series call metrics deferred to Module 13.**
  `AdminAgentService`/`AdminCallQueueService` expose only per-agent +
  per-queue SUMMARY counts (locked decision 12). Deep breakdowns,
  per-seller rollups, and time-series belong to the Reports module.

- **Status-change emails on PENDING_CONFIRMATION exit deferred to
  Module 11.** A call outcome that transitions the order (CONFIRMED /
  REJECTED_* / NDR) sends no customer/seller notification yet —
  notification dispatch is Module 11 (consistent with ORD-3's existing
  email-deferral debt). The `transitionStatus` engine deliberately owns
  status + stock + events + audit only.

- **Click-to-call / Twilio integration deferred to Phase 2.** Agents
  log attempts MANUALLY (`startedAt`/`endedAt`/`outcome` posted to
  `record-attempt`); there is no dialer integration, no auto-populated
  call duration, no telephony webhooks.

- **Voicemail / call-recording storage deferred to Phase 2.**
  `VOICEMAIL_LEFT` is an outcome only; no recording is captured or
  stored. No Spaces bucket / retention policy for call audio.

- **Assignment expiration is pure time-out, no heartbeat (CC-7).** A
  fixed `ops.call_assignment_timeout_minutes` BullMQ delayed job
  reclaims an idle ASSIGNED entry. There is no agent heartbeat / "still
  on the call" keep-alive, so a genuinely long call can be reclaimed at
  the timeout (the agent simply re-pulls; the attempt is unaffected).
  **Pick up:** add a heartbeat-extends-assignment mechanism if long
  calls become common.

## Warehouse Operations (Module 8)

### HIGH-priority latent bug — qtyOnHand never decrements on the normal lifecycle — ✅ RESOLVED (Module 9, Model A)

- **RESOLVED (M9 commit 12, `6d1b71a`) — Model A chosen.** The bug was:
  `stock_levels.qtyOnHand` was never decremented in the normal order
  lifecycle (no `PICK`/`PACK_CONFIRM`/`DISPATCH` movement issued
  anywhere), so every delivered order left `qtyOnHand` inflated by
  `quantity`. M9 resolved it by **Model A — qtyOnHand decrements at
  DISPATCH**: the `PENDING_DISPATCH → DISPATCHED` matrix edge (and, M9
  commit 14, `PENDING_MANUAL_PLACEMENT → DISPATCHED`) gained the
  `DISPATCH_STOCK` side-effect — per phase-2 reservation,
  `StockMutationService` issues a `DISPATCH` movement (`−qtyReserved`)
  and `StockReservationService.fulfill()` consumes the reservation.
  This is the ONE normal-lifecycle qtyOnHand decrement; DELIVERED is
  stock-neutral. **The coupled WMS-8 finalize() was reverted to Model A
  in the SAME atomic commit**: RESTOCK → `RETURN_RESTOCK +qty` re-add;
  WRITE_OFF → no movement (the dispatch decrement stands). The
  `stock-conservation-rto.e2e-spec` break-on-regression assertion was
  flipped to assert the fix (DISPATCH movement fires, qtyOnHand 10→8 at
  dispatch) and the full-lifecycle conservation trace is green. The
  conservation e2e remains a permanent regression guard. **Nothing
  below this line about Model A vs B / "first agenda item" applies any
  more — kept for provenance only.**

  ---
  *Original entry (for provenance):*

- **BUG (latent, HIGH): `stock_levels.qtyOnHand` is never decremented in
  the normal order lifecycle.** `StockReservationService.fulfill()` at
  `DELIVERED` decrements `qtyReserved` (clamped, INV-4) and marks the
  reservation `FULFILLED`, but its JSDoc-promised "separate PICK
  movement for the physical qtyOnHand decrement" was never implemented.
  No `StockMovementType.PICK` / `PACK_CONFIRM` / `DISPATCH` /
  `RETURN_RECEIVE` movement is issued anywhere in M8 (or anywhere
  else; system-wide grep confirms — the only `mutation.apply` call
  sites are `goods-receipt`, `inventory-adjustment`, and M8's
  `warehouse-rto` for `ADJUSTMENT_DECREASE` on WRITE_OFF).

  **Consequence:** every delivered order would leave `qtyOnHand`
  inflated by `quantity` (the ledger says the goods are still on the
  shelf, but they're physically gone). Across many delivered orders,
  inventory drifts unboundedly above reality.

  **Latency:** currently UNREACHABLE in normal operation — no flow
  drives orders to `DELIVERED` without M9 (courier integration) /
  M10 (tracking webhooks). Only god mode (`OrderAdminOverrideService.
  forceMutate`) could force the transition, and it accepts data-
  integrity risk by contract. Tests / staging cannot exercise the
  happy delivery path either, so the bug stays inert behind the M9/M10
  boundary.

  **Resolution requires choosing the qtyOnHand decrement-timing model —
  an M9/M10 design decision needing courier/tracking context:**
  - **Model A** (decrement at DISPATCH): `qtyOnHand` reflects physical
    shelf count at all times. Pick allocates a reservation; DISPATCH
    issues a `PICK` (or new `DISPATCH`) `StockMovement` `-qty`
    decrementing on-hand. RTO re-adds via `RETURN_RESTOCK +qty`.
  - **Model B** (decrement at permanent departure): `qtyOnHand` stays
    static through transit. `DELIVERED`'s `FULFILL_STOCK` saga issues
    a `PICK` / `DISPATCH` `-qty` movement AT delivered (the actual
    physical-departure event); RTO never inflates.

  **COUPLING TO WMS-8 (M8 commit-15 follow-on fix):** The M8 finalize()
  fix is currently RELEASE-BASED — correct under Model B (qtyOnHand
  was never decremented, so RTO doesn't need to add it back; only
  WRITE_OFF needs an `ADJUSTMENT_DECREASE` for the truly-departed unit).
  **Under Model A, `RtoDispositionService.finalize()` RESTOCK path
  MUST be revisited (`RETURN_RESTOCK +qty` becomes correct again, the
  original commit-15 design).** Do NOT fix the qtyOnHand-decrement bug
  without simultaneously revisiting finalize() — this entry links the
  two. The break-on-regression assertion in `test/e2e/stock-
  conservation-rto.e2e-spec.ts` (currently codifies the latent state —
  "no PICK movement issued for the lifecycle") FLIPS the moment Model
  A or B is implemented, forcing the finalize() revisit.

  **Pick up:** Module 9 design conversation begins with this decision.
  This is THE FIRST AGENDA ITEM for M9. Do not resolve reactively.

### M8 commit-15 enum gaps (uncovered during the conservation fix)

- **`StockMovementReasonCode` has no RTO-flavored value.**
  `RtoDispositionService.finalize()` WRITE_OFF path issues
  `ADJUSTMENT_DECREASE -qty` movements with `reasonCode` mapped from
  `shipment_items.rtoCondition`:
  - `DAMAGED` → `DAMAGED_IN_WAREHOUSE`
  - `MISSING` → `LOST`
  - `GOOD` / null → `OTHER` (operationally rare: writing off a GOOD
    item)
  These reuse existing enum values; semantically they're close-but-
  not-exact (`DAMAGED_IN_WAREHOUSE` applies to a unit damaged at the
  RTO receive, not strictly "in our warehouse"; `LOST` applies to a
  unit that returned but was missing from the parcel). **Pick up:**
  add dedicated `RTO_WRITE_OFF_DAMAGED` / `RTO_WRITE_OFF_MISSING` /
  `RTO_WRITE_OFF_OTHER` values in Phase 2 if ops/reports demand
  RTO-specific filtering. Additive enum migration; no backfill.

- **`ReservationReleaseReason` has no RTO terminal value.**
  `RtoDispositionService.finalize()` releases both RESTOCK and
  WRITE_OFF reservations with `reason=OTHER`. The closest existing
  value is `ORDER_REJECTED_BY_COURIER` but that semantically refers to
  pre-shipment courier rejection (e.g., DG goods, weight limits), NOT
  RTO terminal. **Pick up:** add `RTO_FINALIZED` (or split into
  `RTO_RESTOCKED` / `RTO_WRITTEN_OFF`) in Phase 2; additive enum.

### M8 endpoint / feature deferrals

- **Supervisor empty-manifest create endpoint deferred.** In Phase 1A
  manifests are born ONLY from `PackService.complete`'s find-or-create
  logic (one DRAFT per `(courierCode, originWarehouseId)`). There is no
  HTTP endpoint for a supervisor to manually create an empty DRAFT
  manifest. The e2e for `moveShipment` therefore had to insert a target
  DRAFT directly via `prisma.manifest.create`. **Pick up:** if/when
  multi-courier (M9 or Phase 2) introduces use cases where supervisors
  need to pre-create manifests for incoming volume planning, add
  `POST /admin/warehouse/manifests` to `AdminManifestController`.

- **`ManifestService.moveShipment` is dormant in Phase 1A.** With a
  single hardcoded courier (`ops.default_courier_code='delhivery'`) and
  single seeded warehouse (BLR-01), there is typically only ONE DRAFT
  manifest at any moment per `(courierCode, originWarehouseId)`. The
  move endpoint exists, is unit + e2e tested, but has no organic
  multi-DRAFT scenario to flex against. **Pick up:** reachable when M9
  introduces multi-courier serviceability routing or M5/Phase-2
  introduces multi-warehouse.

- **Admin RTO list endpoint deferred (CP3).** `WarehouseRtoController`
  exposes the operator workflow (receive / inspect / finalize) but no
  `GET /admin/warehouse/rto/shipments` for a supervisor list view.
  M12 (Admin Dashboard) will likely surface this alongside other
  operational lists. **Pick up:** add when M12 lands.

### M8 design deferrals (from the original module design)

- **`audit_logs.severity` lives in `metadata.severity`, not a top-level
  column.** Every audit call's `severity` field (`LOW`/`MEDIUM`/`HIGH`/
  `CRITICAL`) is written into `metadata.severity`. Severity-based
  queries currently filter via `metadata.severity` (e.g., the
  conservation e2e asserts `awbAudit.metadata.severity==='HIGH'`).
  **Pick up:** if M13 (Reports) needs efficient severity filtering or
  M12 needs severity-faceted admin dashboards, promote to a top-level
  column with a partial index. Additive migration; backfill from
  `metadata.severity`.

- **Pick batching deferred.** `PickQueueService.pullNext` returns ONE
  shipment per pull. Multi-shipment pick-batch generation (grouping
  pick paths by zone for efficiency) is deferred to Phase 2 when pick
  volume warrants the operational complexity. The current FIFO is a
  reasonable baseline.

- **Voice/scanner integrations deferred.** Picker recordItem is a JSON
  POST with bin/batch IDs the operator types/selects. Barcode scanner
  integration, voice-pick, or RF-gun integration are all Phase 2.

- **Multi-warehouse pick routing deferred.** Phase 1A has a single
  warehouse (BLR-01, hardcoded `ops.default_warehouse_id`). Pick
  allocation uses `WarehouseResolverService` (M5) which has no
  multi-warehouse routing logic. Out-of-scope per CLAUDE.md.

- **Pack-time measurement deferred.** No `packStartedAt` /
  `packCompletedAt` delta tracking surfaced for ops metrics. The schema
  has `packCompletedAt` only; no claim/start column. **Pick up:** add
  `packStartedAt` if M13 wants pack-throughput metrics; M12 supervisor
  dashboard may benefit.

- **Auto-close-manifest-on-threshold deferred.** Manifests close only
  on explicit supervisor action (`AdminManifestController.close`).
  Auto-close at N shipments or T hours is a Phase 2 operational
  convenience. **Pick up:** when manifest volume justifies it (M9
  multi-courier likely triggers).

- **RTO `INSPECT_LATER` / `RETURN_TO_SELLER` dispositions deferred.**
  `RtoDisposition` enum is `RESTOCK` / `WRITE_OFF` only. Phase 2 may
  add `INSPECT_LATER` (defer disposition decision, hold in RTO_HOLD
  bin) and `RETURN_TO_SELLER` (ship back to BD seller). Schema is
  forward-compatible (enum extension; condition column already
  supports DAMAGED/MISSING/GOOD for inspection-later staging).

- **Courier hardcoded to `delhivery`.** `ops.default_courier_code` is
  the single value `ShipmentProvisionService` uses for every parcel.
  Multi-courier serviceability + carrier selection is M9. The
  `ManifestService.attachShipment` find-or-create + `moveShipment`
  same-courier guard are already shaped for multi-courier (the
  per-`(courierCode, originWarehouseId)` advisory lock + courier-match
  validation are forward-compatible).

- **Status-change emails for warehouse transitions deferred to M11.**
  PICKED / PACKED / DISPATCHED / RTO_RECEIVED / RTO_RESTOCKED transitions
  emit NO customer/seller notification yet. M11 (Notifications) owns
  status-change template dispatch. The `transitionStatus` engine
  deliberately owns status + stock + events + audit only (matches CC
  status-change-email debt).

- **M9 AWB enqueue stub in `ManifestService.close` — ✅ RESOLVED (M9
  commit 10).** The stub audit was replaced with a real
  `AwbGenerationQueue.enqueue({manifestId})`; `ManifestStatus` was
  extended with `CONFIRMED`/`DISPATCHED`/`FAILED`. Recorded for
  provenance.

- **AWB stamping was manual in e2e — ✅ RESOLVED (M9).** `warehouse-rto-
  flow` and `stock-conservation-rto` no longer set `shipments.awbNumber`
  directly — they drive `manifest close`, the in-process AWB worker
  generates the AWB (stub-mode Delhivery), and the helpers `waitFor`
  the real `awbNumber` to land. Recorded for provenance.

## Courier Integration (Module 9)

### HIGH-priority real-mode bug — AWB label-upload ordering — ✅ RESOLVED (M10 commit 1)

- **RESOLVED (M10 commit 1).** The fix landed exactly as proposed in the
  original entry — source-of-truth-first / visible-vs-silent ordering,
  mirroring CUR-3 / WMS-8 / RTO-finalize. `AwbGenerationService.
  generateForShipment` now runs in four phases:
  - **A (Phase A — CUR-9 gates).** `shipment.awbNumber !== null` + a
    current `awb_label` row exists → `ALREADY_HAS_AWB` (truly complete).
    `shipment.awbNumber !== null` + NO current `awb_label` row → RECOVERY
    PATH: skip Delhivery entirely, run only Phase D against the
    persisted AWB.
  - **B (Phase B).** Delhivery `generateAwb`. Failure → `FAILED`, no DB
    write.
  - **C (Phase C — tx1, the durable source-of-truth write).** Stamp the
    shipment (`awbNumber` / `courierShipmentId` / `awbGeneratedAt` /
    status `AWB_GENERATED`) + audit `awb.generated`. From this commit
    on the CUR-9 gate fires on any retry — a BullMQ re-delivery CANNOT
    re-call `generateAwb`.
  - **D (Phase D — retryable follow-on).** Fetch label, upload to
    Spaces, tx2 insert the `awb_labels` row (versioned, isCurrent;
    prior current demoted) + audit `awb.label_persisted`. Any failure
    in Phase D returns the new `GENERATED_AWB_LABEL_PENDING` outcome
    (preserves the AWB-is-durable fact).
  - **Job handling.** `AwbGenerationJobService.processManifest` counts
    label-pending outcomes, audits `manifest.awb_job_label_pending` at
    HIGH, and THROWS so BullMQ retries the whole job. On retry the
    Phase-A recovery path runs only the label leg (zero second
    Delhivery calls). The manifest stays CLOSED until every label
    persists — a half-done run is visible, not silent.
  - **Regression guard.** The exact scenario the old ordering would
    have re-charged on is unit-tested in
    `awb-generation.service.spec.ts` ("M10 commit 1 —
    GENERATED_AWB_LABEL_PENDING: tx1 commits then Spaces.putObject
    throws"); the recovery path is asserted to make NO second
    `generateAwb` call.
  - **All M9 AWB e2e (6 suites, 25 tests) stay green after the
    reorder** — generation, supersede, dispatch, conservation, manual
    placement, manifest flow.

  Correct for both stub mode and real mode now. Recorded for provenance.

### M9 design deferrals (from the original module design)

- **Delhivery wire contract is NOT validated — 6 `TODO(delhivery-api)`
  seams.** M9 was built against a clean `DelhiveryClient` adapter
  interface in STUB MODE; the real Delhivery endpoints/auth/payloads/
  error-codes were not reliably known and were NOT hallucinated. Every
  real-mode call site is flagged `TODO(delhivery-api)` and throws until
  validated. The seams: (1) `DelhiveryAwbService.generateAwb` —
  create-shipment endpoint + envelope + response parse + non-serviceable
  vs transient error mapping; (2) `DelhiveryLabelService.fetchLabel` —
  label endpoint + response (bytes vs URL); (3)
  `DelhiveryServiceabilityService` — serviceability/pincode endpoint;
  (4) `DelhiveryHttpService.authHeaders` — the real auth scheme
  (token/API-key header); (5) `DelhiveryHttpService.request` — base URL,
  error envelope, status-code mapping; (6) the rate-limit handling
  (currently retry-only). **Pick up:** a separate sandbox-validation
  task — validate each seam against Delhivery's real sandbox, then flip
  `courier.delhivery_api_base_url` to enable real mode.

- **Proactive serviceability check deferred (CUR-5).**
  `DelhiveryServiceabilityService` exists but nothing calls it on the
  critical path — serviceability is REACTIVE (an AWB rejection routes
  the order to manual placement). A proactive pre-dispatch / pre-confirm
  serviceability check (warn the seller a pincode is non-serviceable
  before the order is taken) is deferred. **Pick up:** Phase 2, or when
  ops asks for it.

- **Multi-courier routing deferred.** Phase 1A has a single integrated
  courier (`delhivery`) + the generic `manual` courier. Carrier
  SELECTION (cheapest/fastest/serviceable courier per shipment), the
  `Courier.priorityForRouting` column, and `ManifestService.moveShipment`
  (DRAFT↔DRAFT, dormant with one courier) all stay unwired.
  `attachShipment`'s per-`(courierCode, originWarehouseId)` find-or-create
  is already shaped for it. **Pick up:** Phase 2 multi-courier work.

- **Delhivery rate-limit handling is retry-only.** The BullMQ AWB job
  retries with backoff (`courier.awb_job_retry_*`); there is no
  token-bucket / proactive throttle against Delhivery's rate limits.
  Adequate at Phase-1A volume. **Pick up:** when AWB volume warrants a
  real client-side limiter.

- **Pickup scheduling is manual.** M9 generates AWBs + hands parcels to
  the courier (`confirmHandoff`) but does NOT call a Delhivery
  pickup-request API — pickup is arranged out of band by ops. **Pick
  up:** Phase 2 if pickup-API integration is wanted.

- **Manual-courier tracking is hand-entered.** A manual-courier shipment
  (`isManualCourier`, CUR-8) has no courier webhook — there is no
  Delhivery-style event feed for a non-integrated carrier in Phase 1A.
  Its post-dispatch `tracking_events` are entered by ops manually. M10's
  public tracking page reads `tracking_events` uniformly; the manual vs
  webhook-driven distinction is upstream. **Pick up:** M10 (tracking)
  surfaces the read side; manual event entry UX is M12 (admin) or later.

- **Post-dispatch ADMIN cancel does NOT auto-restock.** A god-mode /
  admin `→ CANCELLED_BY_ADMIN` from a post-DISPATCHED state carries
  `RELEASE_STOCK`, but under Model A the reservation was already
  `FULFILLED` at dispatch and `qtyOnHand` already decremented — so
  `release()` is a no-op on a fulfilled reservation and **nothing is
  added back to `qtyOnHand`**. This is correct by the Model-A semantics
  (the goods physically left at dispatch; a post-dispatch cancel does
  not teleport them back). If the parcel is genuinely recovered, ops
  re-adds stock via an explicit `ADJUSTMENT_INCREASE` (INV-7) — NOT via
  the cancel path. Recorded so a future reader does not "fix" the
  cancel path to auto-restock. **Pick up:** never (documented design);
  an admin restock-on-recovery UX could wrap the `ADJUSTMENT_INCREASE`
  later.

## Pricing & Multi-Currency (Modules 15–17)

- **Historical FX rate tracking**. Phase 1A keeps a single current rate
  per currency pair; historical conversions use the as-of-then rate
  recorded on the order. Full historical FX rate timeseries deferred to
  Phase 1B.
  **Pick up:** Phase 1B with the remittance/wallet work.
