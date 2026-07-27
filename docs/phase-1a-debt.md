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

- **Email enqueue not wired in `transitionStatus()` — ✅ RESOLVED (M11).**
  Status-change rule #2 ("email enqueue inside the tx") is satisfied
  obliquely — not by enqueueing INSIDE the tx but by emitting a
  lifecycle event POST-COMMIT (the 6th post-commit hook in
  `OrderWriteService.transitionStatus`, NOTIF-1) to the R3
  `OrderLifecycleEventBus`. The `NotificationListener` (M11 commit 6)
  is the subscriber; it resolves the fan-out via
  `NotificationEventMappingService` (NOTIF-4) and calls
  `NotificationLedgerService.enqueue()` per target (NOTIF-2/3/8).
  The original rule's "email inside the tx" intent — atomic with the
  status update — is replaced by a stronger guarantee: the
  notification_logs row is INSERTed (PG durable) BEFORE the BullMQ
  send job is enqueued, and the composite-key partial-unique
  `(event_id, recipient_type, recipient_id, channel, template_code)
  WHERE event_id IS NOT NULL` dedup gate makes a re-emit on the same
  lifecycle event a no-op (NOTIF-2 store-then-send). The order module
  remains unaware of notifications (NOTIF-5); the bus is the
  dependency-free shared primitive (R3 #4, the same shape as
  `call-queue` / `shipment-provision`). Recorded for provenance.

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

- **Status-change emails on PENDING_CONFIRMATION exit — ✅ RESOLVED
  (M11).** Call outcomes that transition the order (CONFIRMED /
  REJECTED_* / NDR) now fan out via the same NOTIF-1 lifecycle-event
  emit path used by every other transition (the CC-3 attempt → M5/M6
  saga → `transitionStatus` chain feeds the bus uniformly; the call-
  attempt itself is not the trigger, the resulting transition is —
  which means the CC-1 append-only attempt and the notification fan-
  out share NO state and CANNOT corrupt each other). `transitionStatus`
  still owns status + stock + events + audit only; notification fan-
  out is the post-commit subscriber's job (NOTIF-3/4/5). Recorded for
  provenance.

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

- **Status-change emails for warehouse transitions — ✅ RESOLVED (M11).**
  The R3 lifecycle event bus is fed by `OrderWriteService.transitionStatus`,
  which IS the call path warehouse-pick / warehouse-pack / warehouse-rto
  use (per WMS-9: cross-module readers go through the order facade, not
  shipment columns); every PICKED / PACKED / DISPATCHED / RTO_RECEIVED /
  RTO_RESTOCKED transition fires the post-commit emit and the M11
  mapping decides per-status fan-out (DISPATCHED + RTO_INITIATED +
  RTO_RECEIVED are wired in the Q5 mapping; PICKED / PACKED are
  internal-only by Q5 — listener sees them, mapping resolves [],
  zero ledger writes). `transitionStatus` still owns status + stock +
  events + audit only; the lifecycle bus is the new sixth post-commit
  hook (matching the documented CC / RTO / pack-eligible / shipment-
  provision pattern). Recorded for provenance.

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
  Its post-dispatch `tracking_events` are entered by ops manually. M10
  surfaced the read side (`PublicTrackingReadService` reads
  `tracking_events` uniformly) AND the WRITE side
  (`POST /admin/tracking/shipments/:shipmentId/manual-scan` —
  `ManualTrackingService`, TRK-9). The admin UI for the manual-scan
  entry remains deferred. **Pick up:** API-side complete in M10; admin
  UI in M12.

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

## Public Tracking (Module 10)

### M10 design deferrals

- **Delhivery wire contract — TWO NEW `TODO(delhivery-api)` seams
  joining M9's existing 6 (8 total).** M10 was built against
  `DelhiveryClient.normalizeScan` in stub mode (the deterministic
  `DLV-IN-TRANSIT` / `DLV-OFD` / `DLV-DELIVERED` / `DLV-NDR` /
  `DLV-RTO-INIT` / `DLV-RTO-IT` / `DLV-RTO-DEL` / `DLV-LOST` /
  `DLV-DAMAGED` table); the real Delhivery scan-code taxonomy is NOT
  reliably known. Similarly, the webhook HMAC scheme (algorithm:
  SHA-256 vs SHA-1; encoding: hex vs base64; the header NAME the
  courier uses; replay-protection timestamp/nonce window; body
  canonicalization) is NOT validated — Phase 1A reads
  `x-skydrop-signature` as hex-encoded HMAC-SHA256 over the raw bytes,
  matching the WebhookAuthService stub. Both NEW seams are flagged
  `TODO(delhivery-api)` at the implementation site
  (`DelhiveryTrackingService.normalizeScan` JSDoc; `WebhookAuthService`
  JSDoc). **Pick up:** the same sandbox-validation task that closes the
  M9 wire seams — flip together when Delhivery sandbox credentials are
  wired.

- **Customer-facing tracking page (`apps/track`) deferred to the
  frontend cycle.** M10 ships the API layer end-to-end —
  `PublicTrackingReadService.findByAwb` returns the customer-safe
  projection; the controller is open + rate-limited. The SSR Next.js
  page (EN + HI per the original M10 plan) that reads
  `GET /public/tracking/:awbNumber` and renders the timeline is a
  frontend-cycle deliverable; `apps/track` is a placeholder. The API
  contract is i18n-neutral (enum-style display statuses, no localized
  copy in the response) — the frontend owns the translation tables.
  **Pick up:** the frontend cycle (alongside the seller / admin /
  marketing apps).

- **NDR → call-center re-queue loop deferred to Phase 2.** A
  DELIVERY_FAILED order currently sits in its terminal-ish state with
  a recorded `delivery_attempts` row until the next courier scan
  (redelivery → OUT_FOR_DELIVERY, or RTO_INITIATED). In Phase 2 the
  workflow should auto-enqueue the order back into the call-center
  queue (CC-6 shape) so an agent can confirm the customer's
  availability before redelivery. The plumbing is mostly there — CC-6
  is the enqueue mechanism, the matrix supports DELIVERY_FAILED →
  OUT_FOR_DELIVERY for the retry — but the NDR → call-center bridge
  service does NOT exist yet. **Pick up:** Phase 2 when the call-center
  capacity model is sized for NDR retries.

- **Public tracking rate-limit value is hard-coded in the controller.**
  The seed `tracking.public_lookup_rate_limit_per_min = 30` documents
  the intent + is the future hook, but `@Throttle({ default: { limit:
  30, ttl: minutes(1) } })` on `PublicTrackingController` takes a
  static literal — the seed value is duplicated in code. Tuning the
  limit requires a redeploy. A dynamic-limit guard that reads the seed
  at startup (or on each request, cached) is straightforward but
  unnecessary at Phase-1A volume. **Pick up:** when ops asks to tune
  without a deploy.

- **Manual-tracking endpoint has no per-request idempotency key.** A
  double-submit by an operator produces two `tracking_events` rows
  (and, for DELIVERY_ATTEMPTED, two `delivery_attempts` rows with
  sequential attemptNumber). The actorId + eventAt on the rows makes
  corrections discoverable via the audit trail; an idempotency-key
  header would prevent the duplicate up front. Deferred because the
  ops workflow is supervised + the audit path exists. **Pick up:** if
  duplicate-submit incidents become an ops complaint.

- **Public tracking page i18n is API-neutral.** The API returns
  enum-style display statuses (`PublicShipmentDisplayStatus`); the EN
  + HI localized copy lives in the deferred frontend
  (`packages/i18n`). The original M10 plan called for EN + HI; this
  remains as a frontend deliverable. Recorded so the frontend cycle
  knows the translation table to author. **Pick up:** with the
  customer-facing frontend page above.

## Notifications (Module 11)

### M11 design deferrals

- **Two idempotency regimes coexist on notification_logs.** Pre-M11
  fire-once sites (auth/seller-mgmt/inventory/category-proposal — the
  8+ existing callers) dedup via the polymorphic
  `(templateCode, recipientType, recipientId)` LOOKUP in the caller
  service BEFORE enqueueing; the row carries NO eventId and lives
  outside the M11 partial-unique gate. M11 lifecycle fan-out callers
  set `eventId = order_status:<statusEventId>` and rely on the
  partial-unique `(event_id, recipient_type, recipient_id, channel,
  template_code) WHERE event_id IS NOT NULL` for dedup
  (NOTIF-2 store-then-send). Both regimes operate on the same table
  without conflict — the partial-unique only fires when eventId is
  present, the legacy lookup ignores eventId entirely. **DO NOT add
  eventId to legacy callers** without auditing their dedup logic; they
  would suddenly start consuming the M11 gate and could double-write
  on a logical re-fire that the legacy template-code lookup currently
  catches. Conversely, NEW lifecycle-event fan-out paths MUST set
  eventId — the partial-unique is the only protection. **Pick up:**
  potentially migrate legacy callers to the eventId regime in a Phase-2
  cleanup, with per-caller audit of their re-fire semantics; not
  urgent.

- **NDR ndr_reason variable is empty — ✅ RESOLVED (M13 CP2.A.1).**
  `NotificationListener.loadOrderContext` now fetches the latest
  `delivery_attempts` row (per-shipment, ordered by `attemptedAt
  DESC LIMIT 1`) and surfaces `failureReason` (humanized — the enum
  `CUSTOMER_PHONE_UNREACHABLE` becomes `'Customer Phone Unreachable'`)
  with a free-text `failureNotes` fallback and empty-string fallback
  when neither is present (preserves the generic-NDR copy that the
  M11 templates were authored against). The same query shape is the
  load-bearing addition; admin-side `/events` UI (separate concern)
  is unaffected. The fix is pinned by three unit tests in
  `notification-listener.service.spec.ts` (`DELIVERY_FAILED —
  ndr_reason surfaces ...` describe block: humanized enum / notes
  fallback / empty-no-attempt). Recorded for provenance.

- **Listener fan-out is best-effort, NO retry of the LISTENER itself.**
  NOTIF-1 says the listener is best-effort; an error in
  `loadOrderContext` (e.g., the order vanished between emit and load —
  observed as the soft-delete / race log line) returns silently with
  zero ledger rows. Per-target failures inside the loop are isolated
  (NOTIF-3) — one target's enqueue() throw never aborts the others —
  but the FAILED target itself has no retry. The DOWNSTREAM ledger row
  IS retried by BullMQ (5 attempts, the existing email queue policy)
  once it is enqueued; the failure window is strictly the
  "load + per-target enqueue" path. An out-of-band reconciler that
  walks transitions without matching ledger rows would close the gap;
  not built in Phase 1A. **Pick up:** if observed listener-side
  failures become a real ops concern (the M11 commits' log lines are
  the forensic trail; an alert on the `'NotificationListener: ...
  swallowed'` log level pages ops).

- **The bus is in-process — single-instance API only.** The R3
  `OrderLifecycleEventBus` is an in-process rxjs Subject; a multi-
  instance API deployment would need a Redis pub/sub (BullMQ events
  or rxjs over Redis) — emit on instance A would not reach a listener
  on instance B. Phase 1A runs a single API instance per droplet so
  this is a non-issue, but the seam is documented (the bus
  module-comment flags it). **Pick up:** Phase-2 multi-instance API
  (likely with the marketing/seller/admin frontends scaling
  separately).

- **Locale is hard-coded 'en' even for customer templates.** The Q6
  decision was bilingual-in-one-email — the seeded customer EN-tagged
  templates contain BOTH English + Hindi blocks. So the listener
  passes `locale: 'en'` and the rendered body has both languages. A
  per-recipient stored locale preference (Phase-2 customer model
  enhancement) would let us split into separate EN-only / HI-only
  templates — the mapping is the single seam to change. **Pick up:**
  when the Phase-2 customer profile model lands stored locale
  preferences.

- **Force-exit warning in e2e is pre-existing (BullMQ + ioredis
  internal handles).** `jest.e2e.config.ts` sets `forceExit: true` —
  needed since M1 because BullMQ + ioredis hold internal connection
  handles past `app.close()` even after `worker.close()` / `client
  .quit()`. The "Force exiting Jest async operations" line prints
  whenever forceExit is on AND a handle is pending; removing forceExit
  hangs jest 60s+ on a single suite. The M11 follow-up commit
  drained the listener's own in-flight handle() promises (which fixed
  the actual cross-suite TRUNCATE deadlock — `40P01` from notification_logs
  FK locks racing the harness reset); the warning is unrelated to
  M11 and remains. **Pick up:** the BullMQ + ioredis handle leak is
  upstream; revisit only if forceExit ever becomes the wrong default
  (e.g., a future test wants to assert post-teardown state).

## Admin Dashboard + Frontend Foundation (Module 12)

### M12 design deferrals

- **`ORDER_VIEW_INCLUDE` is items-only on the admin order detail
  endpoint** — no `events`, no `delivery_attempts`. This is a single
  shared root that blocks TWO M12 follow-ups:
    1. **Lifecycle history timeline on the order detail page.** The
       UI currently renders Recipient / Payment / Physical / Items /
       Notes but NOT the order_events history. A future admin
       endpoint that includes `events` (filtered to admin-visible
       rows) lights up the section.
    2. **M11 NDR `ndr_reason` debt closure (#13 from the M12 plan).**
       The customer-side NDR notification template's `ndr_reason`
       variable is empty because the listener loads the order header
       without the latest `delivery_attempts.reason`. Adding
       `delivery_attempts` (latest, scoped to non-cancelled
       shipments) to the same admin include unblocks the listener's
       `buildVariables` to surface a real reason.
  Both are unblocked by one small backend change — a deliberate
  admin events/delivery-attempts include on the order view. The two
  share a root by design: the M12 plan explicitly chose NOT to
  expand the endpoint inside M12 (the /me cookie path was the only
  sanctioned backend touch), so both stay as debt for the same
  follow-up. **Pick up:** a small backend commit on the order
  domain when admin dashboard timeline + M11 NDR copy are
  prioritised; one PR closes both.

- **Component extraction to `packages/ui` is intentionally
  deferred until apps/seller forces the shape.** Every admin
  component lives in `apps/admin/src/components/ui/` and is
  TOKEN-DRIVEN — no `@/...` imports inside that folder. When
  apps/seller lands (M13 frontend cycle direction), the entire
  folder lifts to `packages/ui/src/components/` and the shared API
  is shaped against the dual-app demand. Premature abstraction
  with only one app would shape the API around admin's quirks; the
  delay is a deliberate quality bet. The token system + status
  mapping ARE shared from M12 onward (FE-6).
  **Pick up:** with apps/seller scaffolding (M13+ frontend cycle).

- **Warehouse-ops and queue-management feature areas in
  apps/admin are M12 fast-follow modules.** The CP2 scope was
  Seller management + Order ops; the M12 spec explicitly excluded
  Warehouse + Queue management. Both fit cleanly into the
  existing patterns (list → detail → action → audit template
  from CP2.7; same shared component primitives; same RBAC
  cosmetic gates; the M8/M9 endpoints are already exposed). No
  architectural blockers — just feature scope.
  **Pick up:** as standalone fast-follow modules once apps/seller
  shapes the shared-component API more firmly.

- **`moduleResolution: bundler` source-vs-dist consumption
  discipline** — packages use extension-less relative imports
  (`from './client'` not `'./client.js'`) so Next.js webpack
  resolves directly from `src/` via tsconfig paths. apps/api
  consumes built dist/ via package `main`. When apps/seller
  lands as a SECOND Next.js consumer, verify the same discipline
  holds (both apps' tsconfigs have aliases pointing at packages/X/
  src/index.ts) — and that the BUILT dist/ stays consistent
  (apps/admin's production build needs `paths: {}` in
  tsconfig.build.json to override the inherited base; without it
  the build emits into the wrong rootDir). The M12 packages all
  do this correctly today; the comment is a guard against
  drift.
  **Pick up:** if/when apps/seller's build surfaces a
  resolution issue.

- **Frontend e2e harness (Playwright) deferred to apps/seller.**
  The cost-benefit calc at M12 strongly favored
  integration-tests + a documented manual smoke
  (`apps/admin/CP2_FEATURE_SMOKE.md`) over a Playwright
  installation (~150MB browsers + harness time). When apps/seller
  doubles the surface, Playwright amortizes across two apps and
  becomes the right investment — the manual smoke then becomes
  documentation, not the test gate.
  **Pick up:** with apps/seller, OR earlier if a UI regression
  occurs that the boundary + manual-smoke layers don't catch.

- **Cosmetic RBAC awaits server gates landing.** The M12 UI gates
  Suspend/Reapprove behind `SUPER_ADMIN` / `SELLER_APPROVAL_ADMIN`
  and god-mode behind `SUPER_ADMIN` only — but the underlying
  endpoints have NO `requireStaffRoles` on them today (every admin
  endpoint is `StaffJwtGuard`-only in Phase 1A). When the server
  RBAC sweep lands, the cosmetic gates become accurate by
  construction (UI mirrors the server). Until then, the FE-2
  discipline holds: even with the UI's cosmetic gates open, the
  server rejects with `[INSUFFICIENT_ROLE]` and the UI displays it
  verbatim (pinned by `seller-status-fe2.test.tsx`).
  **Pick up:** with the server RBAC sweep across all admin
  endpoints.

- **Login-form one-shot ApiClient** — the /login page is not
  wrapped in `<AuthProvider>` (the provider mounts under (authed)
  only). The form instantiates its own one-shot `ApiClient` to
  perform the login mutation. On success, a hard navigation
  (`window.location.assign('/dashboard')`) triggers a fresh SSR
  pass that hydrates identity via cookie→/me + mints a fresh
  access token via silent-refresh. This is intentional symmetry
  (every authed page gets its token via a refresh, never via the
  login response), but it costs one extra network round-trip on
  login. A future optimization could persist the access token via
  a server action that ALSO sets the cookie, eliminating the
  refresh — at the cost of a more complex auth-state hand-off.
  Not worth it at Phase-1A scale.
  **Pick up:** if login-time latency becomes a UX concern.

## Pricing & Multi-Currency (Modules 15–17)

- **Historical FX rate tracking**. Phase 1A keeps a single current rate
  per currency pair; historical conversions use the as-of-then rate
  recorded on the order. Full historical FX rate timeseries deferred to
  Phase 1B.
  **Pick up:** Phase 1B with the remittance/wallet work.

## Delhivery capabilities without a workflow (D-phase → courier-ops)

The D1–D7 work built eleven capability services against the Delhivery
contract. The `courier-ops` module (2026-07-27) gave nine of them a
caller. Two remain uncalled, and NOT because the wiring was skipped —
the workflows they attach to do not exist. Building an admin endpoint
that called them with hand-typed inputs would look like an integration
and be a decoration.

- **MPS (multi-piece shipments) — `DelhiveryMpsService.plan`.** One
  order that physically travels as several boxes. Every box needs its
  OWN pre-fetched waybill, one is nominated master, and `master_id` on
  each is what makes them one consignment rather than three unrelated
  parcels with three tracking identities.

  Blocked on a data model, not on wiring: `shipments` is one parcel with
  one AWB (`awbNumber` is UNIQUE and CUR-9 makes "exactly one AWB per
  shipment" an invariant), and nothing anywhere models a box. Wiring
  this needs (a) a `shipment_boxes` table with per-box weight and dims,
  (b) the pack flow recording how many boxes a parcel actually became,
  (c) the D3 pool claiming N waybills per consignment instead of one,
  and (d) the AWB generation saga building an MPS create — which means
  re-reading CUR-9, since "one AWB per shipment" stops being true.
  `mps_amount` is the COD total for the WHOLE consignment; repeating it
  per box would ask the customer to pay three times.
  **Pick up:** when a seller ships something that genuinely does not fit
  in one box. Until then the single-parcel path is correct.

- **RVP QC — `DelhiveryRvpQcService.buildQcKeys`.** The quality-check
  questions a reverse pickup carries, so the rider can verify the
  returned item at the customer's door before accepting it.

  Blocked on a flow that does not exist: there is no reverse-pickup
  creation anywhere in the system. RTO today is entirely
  courier-initiated — a delivery fails, the parcel comes back, and
  `RtoReceiptService` handles the arrival. A seller- or
  customer-initiated return pickup (the thing RVP QC exists to
  accompany) has never been built.
  **Pick up:** with a customer-returns feature. The QC key builder is
  ready for it; the flow around it is the work.

Also open from the same pass:

- **The write path has never touched the real Delhivery server.** Every
  production call verified so far was read-only. Nine capabilities now
  have callers, all gated by the default-OFF write guard. The controlled
  first-parcel test — enable the guard, create exactly one shipment to
  an address you control, verify, disable — is what turns 7 remaining
  `TODO(delhivery-api)` seams from assumed to known.
  **Pick up:** before any real seller traffic. The procedure is written up
  at `docs/delhivery-go-live-test.md` — it creates one real consignment to an
  address you control and CANCELS it before anything moves, so the write path
  is proven without a parcel actually shipping.

- **NDR actions are operator-triggered only.** Delhivery advises firing
  them after 21:00 IST, once the day's failed parcels are physically
  back at the facility, which makes a nightly sweep the better long-term
  shape than a button. Deliberately not built yet: automating an
  unproven wire call is worse than not automating it.
  **Pick up:** after the first-parcel test proves the contract.


## Concurrency audit (2026-07-27)

Docker came back, so the system could finally be driven over real HTTP
against a real database rather than reasoned about. Five bugs, four
fixed, one recorded. Recording the shape here because the same shape
will recur.

**The shape:** an irreversible or money-moving act, guarded by a check
that reads OUTSIDE the transaction that does the writing. The check and
the write are then two separate operations, and anything that repeats
the caller — a BullMQ retry, a double-clicked button, a second operator
— slips between them.

Fixed:

1. **A closed pickup blocked the whole day.** An unconditional unique on
   (courier, warehouse, date) enforced something stricter than Delhivery
   does. Now partial, `WHERE status IN ('requested','failed')`.
   Invisible to unit tests by construction — a mocked Prisma has no
   index to violate.
2. **A DB hiccup could email a customer five times.** The provider was
   called, THEN the ledger row written; a write failure propagated,
   failed the job, and the retry re-sent. Once the provider accepts, a
   ledger failure is now logged and reported SENT.
3. **The waybill cron spent a real allocation on nobody.** Nothing
   consumes the pool — AWB generation lets Delhivery assign inline.
   Gated off until something drinks.
4. **A double-clicked refund paid the seller twice.** `TicketService`
   read the ticket outside the tx and updated on `where: { id }` alone.
   Now claims the transition first, guarded on the validated status.
   Same guard added to `WithdrawalRequestService` (lower severity — that
   row does not move money, but it can detach a remittance from the
   request it paid).

**Recorded, not fixed — the AWB persist window.** If the transaction
that stamps `awbNumber` fails AFTER Delhivery issued a real number, the
CUR-9 gate sees null on retry and `generateAwb` is called again: a
second real AWB and a second charge. The window is small (one short
local transaction) and the label-upload case it descends from was
already fixed in M10. The proper fix is to claim a pooled waybill BEFORE
the create call, which makes the number durable ahead of the
irreversible act — and would give the D3 pool the consumer it lacks. Not
done now because changing the live AWB path immediately before the
first-parcel test is the wrong trade.
**Pick up:** with MPS, which needs the pool anyway.
