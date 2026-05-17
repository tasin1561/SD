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

- **`StockReservationService.listActiveForOrder` — sanctioned boundary
  expansion.** Added in commit 12 so `OrderWriteService` can target a
  prior transition's reservations for release/fulfill without querying
  `stock_reservations` directly (CLAUDE MUST #15). Same expand-by-need
  precedent as `CatalogReadService` (`productName`/`imageUrl` added for
  the order-item snapshot in commit 9). Read-only, ACTIVE-filtered.
  **Pick up:** ongoing convention; revisit if the M5 cross-module
  surface grows unwieldy.

## Pricing & Multi-Currency (Modules 15–17)

- **Historical FX rate tracking**. Phase 1A keeps a single current rate
  per currency pair; historical conversions use the as-of-then rate
  recorded on the order. Full historical FX rate timeseries deferred to
  Phase 1B.
  **Pick up:** Phase 1B with the remittance/wallet work.
