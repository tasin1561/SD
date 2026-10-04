# Phase 1A Debt

Tracking explicit deferrals from the original module specs. Each entry names
the gap, why we deferred it, and where (which later module) we expect to
pick it up.

**Coverage, read this first (reviewed 2026-09-15; stale entries pruned
2026-10-04).** The module sections below were written against Phase 1A and the
R-phases. Everything after 2026-08-21 — the two-leg consignments, the treasury
and P&L audits, the courier cost and invoice work, labelling and scanning, the
carry-forward P&L, and reseller stores (RS-1..RS-12) — is recorded in
`CLAUDE.md`, not here, and `CLAUDE.md` is the authority where the two disagree.
The "Open as of 2026-09-15" section directly below is this doc's current list;
an older entry marked RESOLVED stays for the reasoning that produced it.

**A stale deferral is worse than a missing one, which is why this file gets
pruned and not only appended to.** An entry claiming something is absent when
it shipped sends the next reader one of two ways: re-implementing a guard that
already exists, or — the expensive direction — treating a secured surface as
open. On 2026-10-04, **twenty-seven entries were found describing code that no
longer exists**, every verdict checked against the code rather than against
another document (`docs/bug-audit-2026-10.md` §4 is the audit; two entries it
examined were accurate and were left alone). Two were stale in their PREMISE
rather than a detail: the `qtyOnHand` resolution still read as Model A months
after the decrement moved to PACK, because the `DISPATCH_STOCK` side-effect
deliberately kept its name. **The failure shape is RBAC-1's** — several
mutually consistent documents, all agreeing, all describing a mechanism that
had been replaced. Nothing in the gate can see it, so **when a deferral
closes, delete or rewrite its entry in the same change as the code**.

---

## Open as of 2026-09-15

Verified against the code on the day of writing, not inherited from an older
list. Everything here is deferred on purpose; none of it blocks the pilot.

- **A freight share charged before WAL-8 has no reversal.** WAL-8 now withholds
  the inbound-freight share on an order with no carriage evidence, so this
  cannot recur — but an order billed a share BEFORE that rule and later called
  off keeps it. Correcting one is a manual wallet credit. **Pick up:** only if a
  real order is found in that state; the set is closed and small.

- **`courier.delhivery_invoice_dispute_days` (15) is OUR assumption.** It
  decides whether a disagreement on a Delhivery invoice is raised HIGH or
  MEDIUM. Delhivery's actual dispute window is unknown and has never been
  confirmed with them. **Pick up:** ask Delhivery; the setting is editable, so
  this is a question, not a code change.

- **Invoices Delhivery will not hand over.** `delhivery-invoice-file:<invoice>`
  issues stay open by design for an invoice whose itemized file fails to
  download in their own panel as well as ours (EPH26251703, 13 Sep). They close
  themselves if the file ever appears. **Pick up:** raise with Delhivery.

- **MPS (multi-piece shipments) and RVP QC are still unwired**, as recorded in
  the D-phase section below. Neither is blocked on wiring: MPS needs a
  `shipment_boxes` model, N-waybill claiming, and an AWB saga that breaks
  CUR-9's once-only gate; RVP QC needs a reverse-pickup creation flow, and RTO
  today is entirely courier-initiated.

- **Reseller store orders are built and deployed but switched OFF.**
  `reseller.orders_enabled` is seeded false and is meant to be enabled per
  seller (`PATCH /admin/sellers/:id/settings/reseller.orders_enabled`) after one
  clean end-to-end run. This is a rollout gate, not unfinished work.

- **`apps/workers` is built and not deployed.** All 17 BullMQ workers run
  in-process inside `skydrop-api` under SCALE-1's `WORKERS_ENABLED`. Any design
  that depends on background work running in a process that serves no HTTP must
  split the process first, not assume the separation is in effect.

- **`packages/types`, `packages/i18n` and `packages/utils` are README-only
  placeholders.** Nothing imports them. They are not a plan.

- **Dependency advisories — the three named upgrades LANDED; the count here
  has a shelf life and this paragraph no longer carries one.** As of
  2026-10-04 the lockfile holds `next` 15.5.25, `sharp` 0.35.4 and `multer`
  2.3.0, so the two CRITICAL `next` advisories (the Windows RCE and the Image
  Optimization one), the `sharp` HIGH in libheif, and the three `multer` DoS
  advisories are all closed. The `multer` half is worth noting because the
  entry expected it to need an override or a Nest bump and it arrived through
  the dependency tree instead.
  **What stays is the lesson, not the number.** This entry was written as
  "13 on the PRODUCTION path (2 critical), 35 in total — measured 2026-09-15",
  which replaced an "eight, all build/test tooling" line that was true on
  2026-07-28. Advisories accrue with time, so a dated count in a document is a
  claim that goes stale on its own, with nothing to announce it. **Do not
  record a new count here.** Run `pnpm audit --prod` when the question comes
  up; that is the only answer with a date on it. An upgrade still needs the
  owner's go-ahead (MUST NOT #5) and a full CI run behind it.

- **The e2e suite and the Playwright projects cannot run on the dev machine** —
  this WSL distro has no Docker — so CI is the first place they execute. A
  behaviour change must be grepped against the e2e specs before pushing, because
  nothing local will catch a spec that still asserts the old behaviour.

---

## Auth module (Module 1)

- **RBAC enforcement on staff endpoints — ✅ SHIPPED, as PERMISSIONS rather
  than the roles this entry anticipated.** `SellerInvitationAdminController`
  carries `@RequirePermissions('sellers.view')` at the class with
  `'sellers.invite'` on create / resend / delete
  (`seller-invitation.controller.ts:40,46,64,77`). The design question this
  entry was waiting on — "the full role/action matrix across all 18 modules" —
  was answered by not building a matrix at all: an endpoint declares the
  PERMISSION it needs, a role is a bag of permissions an admin composes, and
  **an endpoint that declares nothing is REFUSED** rather than open
  (`require-permissions.decorator.ts:30-35`). That inversion is what made the
  sweep finishable; the matrix never would have been.
  **The scaffolding outlived the mechanism, which is the RBAC-1 shape.** The
  controller's own docblock still reads "any authenticated staff member may
  invite/list/resend/delete. Role-based scoping … lands with the RBAC module",
  directly above the decorators that do it. Nothing in the gate can see a
  comment describing the opposite of its own file.

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

- **RBAC enforcement on `/admin/sellers/*` — ✅ SHIPPED.** Every handler on
  `AdminSellerController` is behind a named permission: `sellers.view` at the
  class, then `sellers.approve` / `sellers.suspend` on the status writes,
  `sellers.notes.manage` on the three note handlers, and
  `sellers.bank_account.reveal` on its own key
  (`admin-seller.controller.ts:50,70,85,100,123,148,161,175,196`). The read /
  write split this entry asked for came out finer than "CSR roles read-only":
  revealing a bank account is its own permission rather than part of reading a
  seller, because it is a different act with a different consequence.
  **The note-authorship gap below is NOT closed by this** — a permission says
  who may edit a note, not whose note it is.

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

- **Categories were removed (2026-08-01), and with them three debt
  entries.** The attribute-cache invalidation race, the soft-warning
  attribute-def delete, and the missing product-level attribute
  proposal flow all described machinery that no longer exists.
  `product_variants.attributes` is now free-form, which is strictly
  more permissive than before: with no category the effective set was
  empty and every key was rejected as unknown.

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
  **Pick up:** per-seller cooldown config later.

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

- ~~**CSV order imports are single-line only.**~~ **CLOSED 2026-09-29**
  (owner, with the Delhivery bulk-format work). Rows sharing an
  `External Ref` are now LINES OF ONE ORDER —
  `OrderCsvParserService.groupRows`, and `applyBulkPatch` replaces the
  whole line set. It turned out not to be Phase-2 work at all:
  `CreateOrderDto.items` has always taken 1–200 lines and the portal form
  places multi-line orders every day, so only the importer was narrower
  than the system behind it. And what it actually did was worse than
  refusing — Delhivery's bulk template repeats `*Sale Order Number` to
  express a two-item order, so the second row found the first by that
  reference and PATCHED it, silently shipping one item where the file
  said two. See ORD-9/ORD-9b in CLAUDE.md.

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

### HIGH-priority latent bug — qtyOnHand never decrements on the normal lifecycle — ✅ RESOLVED (Model C)

- **RESOLVED — and the answer MOVED after this entry was written. The live
  model is C: qtyOnHand decrements at PACK (2026-09-03).** `PICKED → PACKED`
  is the edge that carries `DISPATCH_STOCK`
  (`order-state-machine.service.ts:313`), and both
  `PENDING_DISPATCH → DISPATCHED` and `PENDING_MANUAL_PLACEMENT → DISPATCHED`
  are STOCK-NEUTRAL (`sideEffects: []`). Per phase-2 reservation,
  `StockMutationService` issues a **`PACK_CONFIRM`** movement
  (`−qtyReserved`) and `StockReservationService.fulfill()` consumes the
  reservation, at the moment the box is sealed. The give-back is
  `UNPACK_STOCK` (a `PACK_REVERSED` +qty movement, per-movement idempotent on
  `metadata.reversesMovementId`) for a parcel cancelled after packing but
  before it left the building. CUR-3 in `CLAUDE.md` is the authoritative
  account; read it rather than this paragraph.

  **This entry went on reading as Model A for a month after the edge moved,
  because the side-effect kept its name.** `DISPATCH_STOCK` is deliberately
  still called that — a pointer to where it used to live, so grep history
  over the old commits stays legible
  (`order-state-machine.service.ts:36-42` says so). The cost is that every
  document naming the side-effect went on describing a dispatch-time
  decrement, with nothing to announce the move: the name is the evidence a
  reader checks, and it was engineered to stay still. If a future change
  moves it again, **rename the side-effect, or accept that the prose will not
  follow it.**

  The original resolution, for provenance: **M9 commit 12 (`6d1b71a`) chose
  Model A** — decrement at DISPATCH, with the coupled WMS-8 `finalize()`
  reverted to `RETURN_RESTOCK +qty` on RESTOCK and no movement on WRITE_OFF
  in the same atomic commit. Model C moved WHICH edge fires the decrement and
  needed **no change to `finalize()` at all**, which is the part worth
  keeping: finalize is decoupled from when the decrement happened, so the
  coupling this entry warned about turned out to be a property of Model A
  rather than of the system. The `stock-conservation-rto.e2e-spec`
  full-lifecycle trace is now CONFIRMED 10/0 → pick 10/2 → PACKED 8/0 →
  DISPATCHED 8/0 → finalize RESTOCK 10/0 / WRITE_OFF 8/0, and remains a
  permanent regression guard. **Nothing below this line about Model A vs B /
  "first agenda item" applies any more — kept for provenance only.**

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

- **Supervisor empty-manifest create endpoint — ✅ SHIPPED.**
  `POST manifests` → `ManifestService.createEmptyDraft` exists on
  `AdminManifestController` (`admin-manifest.controller.ts:79`), behind
  `warehouse.manifest.close` — the same permission as closing one, on the
  reasoning that opening a manifest commits nothing and moves nothing, so it
  is the same supervisor act minus the consequence. It is idempotent per
  `(courier, warehouse)`, so two supervisors preparing the same van get one
  manifest rather than a duplicate. `PackService.complete`'s find-or-create
  is unchanged and is still how manifests are born in the ordinary case.

- **`ManifestService.moveShipment` is dormant in Phase 1A.** With a
  single hardcoded courier (`ops.default_courier_code='delhivery'`) and
  single seeded warehouse (BLR-01), there is typically only ONE DRAFT
  manifest at any moment per `(courierCode, originWarehouseId)`. The
  move endpoint exists, is unit + e2e tested, but has no organic
  multi-DRAFT scenario to flex against. **Pick up:** reachable when M9
  introduces multi-courier serviceability routing or M5/Phase-2
  introduces multi-warehouse.

- **Admin RTO list endpoint — ✅ SHIPPED, as TWO lists rather than one.**
  `WarehouseRtoController` now serves `GET shipments` (returns waiting on a
  supervisor — received but not finalised, plus anything marked for later
  inspection) and `GET awaiting-receipt`
  (`warehouse-rto.controller.ts:59,69`), with `/warehouse/rto` in apps/admin
  reading both. The split is the useful part: "a carton is on the bench and
  nobody has decided" and "the courier says one is coming and nobody has
  received it" are different problems with different next actions, and TRK-6
  means the second is invisible to everything else until a person confirms it
  at the bench.

### M8 design deferrals (from the original module design)

- **`audit_logs.severity` — ✅ PROMOTED to a real column.**
  `severity AuditSeverity @default(LOW)` (`schema.prisma:547`), exactly the
  additive migration this entry proposed. Two details it did not anticipate,
  both deliberate: the value is **still written into `metadata.severity` as
  well**, so every pre-existing reader and e2e assertion keeps working rather
  than being migrated in the same change; and the index is a **migration-only
  PARTIAL index** (`audit_logs_severity_created_at_idx`, `WHERE severity <>
  'low'`) because Prisma cannot express the predicate and an unconditional
  index would be worse than none — the question is always "what is worth
  somebody's attention", and LOW is almost every row.

- **Pick batching deferred.** `PickQueueService.pullNext` returns ONE
  shipment per pull. Multi-shipment pick-batch generation (grouping
  pick paths by zone for efficiency) is deferred to Phase 2 when pick
  volume warrants the operational complexity. The current FIFO is a
  reasonable baseline.

- **Voice-pick and RF-gun deferred; BARCODE SCANNING shipped.** The scanner
  half of this entry is closed: `RecordPickItemDto.scannedSerials`
  (`record-pick-item.dto.ts:26`) takes the serials read off the shelf and is
  REQUIRED for a strict-mode SKU (UNIT-2), `SerialScanner`
  (`apps/admin/src/components/ui/serial-scanner.tsx`) is the shared input,
  and five benches read a code — pick, pack, receive, handover and RTO. A
  scan gun is just a keyboard, which is why this needed a component and a DTO
  field rather than an integration. **Voice-pick and RF-gun are still Phase
  2** and are a genuinely different shape: both need hardware we do not have
  and a hands-free interaction model, not a field on a request.

- **Multi-warehouse pick routing deferred.** Phase 1A has a single
  warehouse (BLR-01, hardcoded `ops.default_warehouse_id`). Pick
  allocation uses `WarehouseResolverService` (M5) which has no
  multi-warehouse routing logic. Out-of-scope per CLAUDE.md.

- **`packStartedAt` EXISTS; the ops METRIC built on it does not.** The
  column landed with PACK-1's pack box (`schema.prisma:3973`) and arrived for
  a different reason than this entry imagined — not as a measurement, but
  denormalised from `pack_boxes.opened_at` so the queue and the floor reports
  can answer "is anyone on this?" without joining every box. `PackBoxService`
  is its only writer, in the same transaction as the box row, and it is
  cleared when the last box is cancelled; `pack_boxes` stays the fact,
  because it is per box and per packer and the column can never be.
  **What is still deferred is the delta**: nothing computes or surfaces a
  pack-throughput figure. **Pick up:** a report, not a schema change — the
  data is there.

- **A manifest CLOSES ITSELF now — not on a threshold, on its last parcel
  leaving.** CUR-4 (amended 2026-09-03) made the handover SCAN the dispatch,
  and `DispatchHandoffService.flipManifestIfComplete`
  (`dispatch-handoff.service.ts:450,479,707`) flips the manifest to
  DISPATCHED once every LIVE parcel on it is `HANDED_TO_COURIER`, by a
  guarded `updateMany` that accepts any non-DISPATCHED state **including
  DRAFT** — a manifest nobody ever closed is the ordinary case now, not an
  anomaly. So "manifests close only on explicit supervisor action" is no
  longer true, and the threshold convenience this entry proposed is moot:
  the completion condition is better than a count or a clock, because a
  parcel still sitting on a manifest is the visible signal that something did
  not go. `ManifestService.close` survives as the supervisor fallback for a
  driver who took a stack before anybody scanned it.

- **`RtoDisposition` has FOUR values — `INSPECT_LATER` shipped as proposed;
  `RETURN_TO_SELLER` shipped as something else entirely.**
  `schema.prisma:6104-6128`: `RESTOCK`, `WRITE_OFF`, `INSPECT_LATER` (exactly
  the deferred design — the goods stay in RTO_HOLD, which BIN-2 keeps out of
  every availability sum, and finalize REFUSES until somebody decides, because
  guessing at the bench sells a broken item or destroys a good one) and
  `HOLD_DAMAGED` (WMS-8d — a RETURN_RESTOCK into the receiving warehouse's
  DAMAGED bin: on hand, never sellable, the seller's property sitting in our
  building rather than a loss, so no inbound-freight share is charged).
  **`RETURN_TO_SELLER` was deliberately NOT made a disposition.** Sending a
  unit back is an admin stock-adjustment DECREASE out of the DAMAGED bin with
  the `RETURNED_TO_SELLER` reason code (INV-7, `schema.prisma:5560`), which
  CNS-6 already uses for the same act on a cancelled consignment — nothing was
  destroyed, somebody has the goods, and "what did we send back" is a
  different question from "what did we lose". A disposition would have put a
  second mechanism behind one answer. **A stale comment survives this**:
  `schema.prisma:6095`, immediately above `RtoItemCondition`, still reads
  "disposition is RESTOCK/WRITE_OFF only".

- **Courier hardcoded to `delhivery` — ✅ GONE.** Shiprocket joined
  Delhivery (`courier-shiprocket`), a courier is reached through a DISPATCHER
  rather than a branch at the call site (CUR-12), failover between them is
  symmetric by construction (CUR-14,
  `courier-shared/services/courier-distribution.service.ts`), and which
  carrier an aggregator uses is decided by
  `courier-awb/services/courier-choice.service.ts` (CUR-17).
  `ops.default_courier_code` survives but is **per seller** now (CUR-19) and
  is resolved by `OrderPostCommitHooksService` and passed into
  `ProvisionShipmentInput` — `ShipmentProvisionService` deliberately never
  reads the key itself, because a global fallback there would silently undo a
  seller pinned to `manual`. The forward-compatibility bet this entry
  recorded paid off: `attachShipment`'s per-`(courierCode,
  originWarehouseId)` lock and `moveShipment`'s courier-match guard needed no
  changes.

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

- **Delhivery wire contract — ✅ VALIDATED 2026-07-27; all six seams
  closed.** The endpoints, auth, rate limits and response shapes were
  captured against the live production API and are recorded in
  `docs/delhivery-integration.md` (distilled) and
  `docs/vendor/delhivery-b2c-api-raw.md` (raw). **None of the four services
  this entry named carries a `TODO(delhivery-api)` any more** — not
  `DelhiveryAwbService`, `DelhiveryLabelService`,
  `DelhiveryServiceabilityService` or `DelhiveryHttpService` — and no
  real-mode call site throws for being unvalidated. The one `throw` left in
  the AWB service is a configuration guard (no pickup location registered),
  which is a different thing and names what to do about it.
  **There was never a sandbox**, which is what this entry's "Pick up" line
  assumed. The account has none, so the only way to validate a WRITE was to
  make one on purpose and watch — see `docs/delhivery-go-live-test.md` and
  the entry further down this file. **Production has been in REAL MODE since
  that work**: reason about write safety from
  `courier.<code>_live_writes_enabled` and `courier.<code>_api_base_url` in
  the DATABASE, never from stub mode and never from a document.

- **Proactive serviceability — ✅ SHIPPED as ADVICE at the two cheapest
  moments; CUR-5 is untouched.** `OrderServiceabilityService.check`
  (`courier-serviceability/services/order-serviceability.service.ts:24-36`)
  is read at order CREATE from the seller's own form
  (`apps/seller/.../orders/new/_components/new-order-form.tsx`) and at
  call-centre CONFIRMATION
  (`apps/admin/.../call-center/_components/call-center-station.tsx:714`),
  through a seller endpoint and an admin one.
  **It warns; it never gates.** At create, refusing would be wrong —
  serviceability changes, our answer may be a day stale, and a seller who
  knows their customer's area better than a lookup should not be blocked by
  it. At confirmation it is worth acting on, because that is the last cheap
  moment: no stock reserved, no AWB bought, and an agent on the phone who can
  ask for a different address. **Every path FAILS OPEN** — a courier that
  will not answer, an unreadable cache or a stub environment all return
  `known: false`, and unknown is not unserviceable. So CUR-5's reactive
  design stands: the AWB rejection is still the thing that routes an order to
  manual placement.

- **Multi-courier routing — ✅ SHIPPED, all three halves.** Carrier
  SELECTION is `CourierChoiceService.decide`
  (`courier-awb/services/courier-choice.service.ts:91`) over the pure
  `CourierOptionSelectionService`
  (`courier-shared/services/courier-option-selection.service.ts`) (CUR-17:
  five policies —
  `SHIPROCKET_DEFAULT`, `CHEAPEST`, `FASTEST`, `CHEAPEST_WITHIN_DAYS`,
  `MANUAL` — all seller-overridable, with `AWAITING_COURIER` as the visible
  place a parcel waits for a MANUAL decision and a TTL sweep that books the
  cheapest itself and says LOUDLY that it did). `Courier.priorityForRouting`
  is read by `courier-selection.service.ts:82,97,117` and
  `courier-distribution.service.ts:267,330`. `ManifestService.moveShipment`
  has an admin caller (`apps/admin/src/lib/api-hooks.ts:879` →
  `POST /admin/warehouse/shipments/:id/move-manifest`).
  **The thing this entry did not foresee is how much of multi-courier is
  NOT routing**: CUR-12 through CUR-16 are mostly about what keeps two
  couriers from becoming two half-systems — one dispatcher per capability, a
  refusal that fails over immediately where a timeout does not, failover
  symmetric by construction, and a STUB that may never answer for a LIVE
  courier.

- **Delhivery rate-limit handling is retry-only.** The BullMQ AWB job
  retries with backoff (`courier.awb_job_retry_*`); there is no
  token-bucket / proactive throttle against Delhivery's rate limits.
  Adequate at Phase-1A volume. **Pick up:** when AWB volume warrants a
  real client-side limiter.

- **Pickup scheduling — ✅ SHIPPED, and the AUTOMATIC path is the ordinary
  one.** `DelhiveryPickupService.requestPickup`
  (`delhivery-pickup.service.ts:58`) is the real call, behind the live-write
  guard because it summons a real van driven by a real person to a real
  building. `CourierPickupService.raiseIfDue` (`courier-pickup.service.ts`)
  is called post-commit from `PackService.complete`, so the first box closed
  that day asks for the van — CUR-10 amendment #3, standing ON since
  2026-09-03.
  **The GRAIN is what made automating this safe at all**: a pickup is
  requested per `(courier, warehouse, day)`, never per parcel, so every later
  box the same day is a no-op because one van already covers the building.
  A FAILED day is deliberately NOT auto-retried — one bad response must not
  become a call fired on every subsequent parcel — which is why
  `/warehouse/pickups` keeps its route for releasing a day and re-raising by
  hand, even though it is delisted from the nav.

- **Manual-courier tracking is hand-entered.** A manual-courier shipment
  (`isManualCourier`, CUR-8) has no courier webhook — there is no
  Delhivery-style event feed for a non-integrated carrier in Phase 1A.
  Its post-dispatch `tracking_events` are entered by ops manually. M10
  surfaced the read side (`PublicTrackingReadService` reads
  `tracking_events` uniformly) AND the WRITE side
  (`POST /admin/tracking/shipments/:shipmentId/manual-scan` —
  `ManualTrackingService`, TRK-9). **The admin UI shipped** —
  `manual-scan-panel.tsx:73` on the order detail page, which invalidates both
  the order and shipment caches on success because a scan can move the order.
  **The hand-entry itself is not debt and will not be closed**: a
  non-integrated carrier has no event feed to subscribe to, so somebody
  typing what the docket says IS the mechanism. TRK-9 is deliberately the
  same mapping and the same monotonic-forward guard as a webhook, with the
  operator supplying `eventAt` explicitly so a backfill lands in the right
  place on the timeline.

- **Post-dispatch ADMIN cancel does NOT auto-restock.** A god-mode / admin
  `→ CANCELLED_BY_ADMIN` from `DISPATCHED` carries plain `RELEASE_STOCK`
  (`order-state-machine.service.ts`, the DISPATCHED edge list), and by then
  the reservation is already `FULFILLED` and `qtyOnHand` already decremented —
  so `release()` is a no-op and **nothing is added back to `qtyOnHand`**.
  **Under Model C that happened at PACK, not at dispatch** (CUR-3,
  2026-09-03; this entry was written against Model A and said "at dispatch").
  The conclusion is unaffected, and in fact holds more widely: PACK is
  strictly earlier than DISPATCH, so a cancel from any post-dispatch state
  finds the same fulfilled reservation. What Model C added is the EARLIER
  cancels — `PACKED` and `PENDING_DISPATCH → CANCELLED_BY_ADMIN` now carry
  `UNPACK_STOCK`, which reverses the `PACK_CONFIRM` movement, because that
  parcel is still in the building and the goods really can be given back.
  Past dispatch they cannot. If the parcel is genuinely recovered, ops re-adds
  stock via an explicit `ADJUSTMENT_INCREASE` (INV-7) — NOT via the cancel
  path. Recorded so a future reader does not "fix" the cancel path to
  auto-restock. **Pick up:** never (documented design); an admin
  restock-on-recovery UX could wrap the `ADJUSTMENT_INCREASE` later.

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

- **Customer-facing tracking page (`apps/track`) — ✅ BUILT AND DEPLOYED.**
  `apps/track/src/app/[awb]/page.tsx` is the SSR timeline page; the app has
  its own layout, locale switcher, sitemap and robots, and it is a CI
  Playwright project (so the nonce-CSP and responsive specs run against it).
  The API contract stayed i18n-neutral as designed — enum-style display
  statuses, no localized copy in the response — and `apps/track` owns the
  translation tables, which is the next entry.
  **One thing to know about it that is not in this entry**: apps/track is its
  own design world and does NOT inherit `@skydrop/ui`'s tokens the way the
  consoles do (FE-6). A rule added for the estate reaches it only if somebody
  adds it there too, which is exactly how a scrollbar rule shipped to three
  sites and not this one on 2026-08-04.

- **NDR → call-center re-queue loop — ✅ SHIPPED, and the bridge is a BUS
  LISTENER rather than a call.** `DeliveryFailedListenerService`
  (`delivery-action/services/delivery-failed-listener.service.ts:81-93`)
  subscribes to the R3 `OrderLifecycleEventBus`, and on
  `to === DELIVERY_FAILED` enqueues the order with
  `CallQueueReason.DELIVERY_FAILED` — a reason of its own, deliberately not
  the confirmation reason, because the agent needs to know before dialling
  that the courier could not deliver rather than that nobody has confirmed the
  order. The plumbing this entry said was "mostly there" was exactly right;
  what it did not anticipate is that the listener had to carry M11's teardown
  discipline (in-flight promises tracked, `drainInFlight()` exposed, awaited
  in `onModuleDestroy`), because a fire-and-forget DB write that outlives its
  trigger deadlocks the e2e reset (NOTIF-19).

- **Public tracking rate limit — ✅ READS THE SETTING.**
  `@ThrottleSetting('tracking.public_lookup_rate_limit_per_min')` sits beside
  the `@Throttle` on `PublicTrackingController`
  (`public-tracking.controller.ts:50`), so the literal is now the fallback
  default rather than the value, and tuning the limit no longer needs a
  deploy. The duplication this entry worried about is the right way round: a
  static default that applies when the setting cannot be read is a
  fail-closed backstop, not a second source of truth.

- **Manual-tracking endpoint has no per-request idempotency key.** A
  double-submit by an operator produces two `tracking_events` rows
  (and, for DELIVERY_ATTEMPTED, two `delivery_attempts` rows with
  sequential attemptNumber). The actorId + eventAt on the rows makes
  corrections discoverable via the audit trail; an idempotency-key
  header would prevent the duplicate up front. Deferred because the
  ops workflow is supervised + the audit path exists. **Pick up:** if
  duplicate-submit incidents become an ops complaint.

- **Public tracking EN + HI — ✅ SHIPPED, and NOT in `packages/i18n`.** The
  translation tables live in `apps/track/src/lib/i18n.ts` with
  `apps/track/src/lib/locale.ts` and a `locale-switcher.tsx` in the top bar;
  the timeline resolves a BCP-47 tag per locale and formats each scan with
  `toLocaleString('hi-IN' | 'en-IN')`
  (`apps/track/src/app/[awb]/_components/journey.tsx:69,81`), and the layout
  loads a Devanagari face only when Hindi is active. The API stayed
  i18n-neutral exactly as designed.
  **`packages/i18n` is still a README-only placeholder and nothing imports
  it** — it is listed in the open section at the top of this file for that
  reason. One app's translation table does not need a package, and putting it
  in one would have been the shared abstraction with a single consumer that
  M12's component-extraction entry argued against.

## Notifications (Module 11)

### M11 design deferrals

- **Two idempotency regimes coexist on notification_logs.** Pre-M11
  fire-once sites (auth/seller-mgmt/inventory — the
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

- **The bus crosses PROCESSES now — ✅ Redis pub/sub landed at the exact
  seam NOTIF-5 named.** `OrderLifecycleEventBus`
  (`order-lifecycle-event-bus.service.ts:111,143-170`) publishes every event
  to a Redis channel and the LISTENING instance subscribes, so an emit on
  instance A reaches a listener on instance B. The publisher/subscriber API
  is unchanged, which is what the R3 split was for.
  **Which instance runs the listeners is the decision this entry did not
  know it was making.** The same instance that owns the BullMQ queues owns
  the listeners (`handlesEvents` reads `WorkerRoleService.enabled`, SCALE-1),
  for the same reason: firing them everywhere would fan every event out N
  times. The downstream dedup gates — NOTIF-2's composite key, CUR-9's AWB
  gate — would absorb most of that, and "mostly" is not a design: a listener
  added later would inherit a hazard nobody wrote down. The publish is
  fire-and-forget like every other post-commit hook (NOTIF-1), so a broker
  that will not take the message can never undo the transition. On a
  single-instance deployment nothing is ever published and the subscriber
  connection sits idle — the price of a second instance being a config change
  rather than a rewrite.

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
  endpoint — ✅ BOTH HALVES RESOLVED.** The NDR half landed with M13
  (`NotificationListener.loadOrderContext` reads the latest
  `delivery_attempts` row per live shipment and humanises
  `failureReason` into `ndr_reason`). The timeline half landed as the
  admin ORDER JOURNEY (938a0ab3), which is a different and better
  answer than the one this entry anticipated: rather than widen the
  order include and add an events endpoint, the journey composes the
  history and filters what a seller may see. The endpoint this entry
  proposed — `GET /admin/orders/:id/events` — was in fact BUILT and
  then retired on 2026-09-15 once the journey superseded it and the
  route checker showed nothing called it. Original text follows.

  ~~This is a single shared root that blocks TWO M12 follow-ups:~~
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

- **Component extraction to `packages/ui` — ✅ DONE with M13 CP1, and the
  quality bet paid.** `packages/ui/src/components/` holds 23 modules behind a
  `./components` subpath, consumed by admin, seller and reseller. The delay
  worked as intended: the API was shaped against real dual-app demand rather
  than around admin's quirks, and the first extraction was seven primitives
  — not the whole folder this entry imagined — because that was what a second
  consumer actually needed.
  **The shape has moved on twice since.** `AppShell` is now the one app
  chrome (FE-7), and the 2026-09-24 restyle deleted `tokens.css`,
  `corridor.css` and `seller-theme.css` in favour of the brand sheets plus a
  `brand/legacy.css` alias layer that maps the old `--color-*` names onto the
  brand for whatever legacy components are still on screen. Read FE-6 / FE-7
  in `CLAUDE.md` for where that stands; this entry is only about the
  extraction.

- **Warehouse-ops and queue-management in apps/admin — ✅ BUILT.** Sixteen
  warehouse routes (the hub, plus pick, pack, printing, handover, receive,
  bins, collapse, manifests, consignments, rto, pickups and four detail
  pages) and three call-center routes (the station, queue and agents). The
  prediction in this entry was accurate and is worth keeping as evidence: no
  architectural blockers appeared, and they did fit the list → detail →
  action → audit template with the shared primitives and cosmetic RBAC gates.
  **The screens arrived faster than the sweep that proves they exist**, which
  is the more useful lesson. A capability with an endpoint and no screen is
  invisible to every roadmap document, so the check is
  `scripts/check-frontend-routes.py` — it runs both directions, gates on
  `call → route`, and only PRINTS the reverse, because a path composed from a
  builder or a prop cannot be seen by a static string scan and a gate that
  fails on a call it could not see is a gate people learn to skip.

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

- **Frontend e2e harness (Playwright) — ✅ INSTALLED with apps/seller, and
  it amortized further than this entry expected.** The root
  `playwright.config.ts` has FIVE projects (admin, seller, track, marketing,
  reseller) and the `browser` job in `.github/workflows/ci.yml` is a real
  gate, not the manual smoke it replaced.
  **The investment paid off in the specs that are SHARED across projects**,
  which is the shape the per-app calculation could not see. `e2e-shared/`
  holds the nonce-CSP check and the responsive quartet, and each runs against
  every project — so a new frontend inherits both by construction. That is
  what caught apps/track shipping a CSP-blocked inline theme script, and
  apps/marketing pushing its landing page 14px past a 320px viewport. Both
  were found by a spec nobody wrote for those apps. `browser` is also the
  ONLY job that builds the Next apps, so that build IS the build check:
  removing an app from its list stops the app's build being checked
  anywhere.

- **The server RBAC sweep — ✅ LANDED, as permissions rather than roles.**
  `@RequirePermissions` is used in 90 files, and the rule that made the
  sweep finishable is the inversion: **an endpoint behind `StaffJwtGuard`
  that declares nothing is REFUSED, not allowed**
  (`require-permissions.decorator.ts:30-35`). Before it, **92 of 156 admin
  handlers carried authentication and no authorisation at all** — a call
  agent could set the exchange rate that converts every seller's money. A new
  controller is now invisible until somebody decides who it is for.
  **The cosmetic half did NOT become accurate by construction**, which this
  entry assumed it would. A role is a bag of permissions an admin composes at
  runtime, so the UI cannot derive from a role name what the server will
  accept — it reads a permission table (`apps/admin/src/lib/page-access.ts`
  and friends) and the server remains the boundary. FE-2 holds unchanged:
  the UI shows the server's `[CODE] message` verbatim and never pre-empts
  it.

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

- **The write path HAS touched the real Delhivery server — ✅ the
  first-parcel test was PERFORMED 2026-08-21.** One real consignment was
  manifested end-to-end through our own system and cancelled with the
  courier; the attempt log is at the bottom of
  `docs/delhivery-go-live-test.md`. Since then
  `courier.delhivery_live_writes_enabled` has been TRUE against
  `https://track.delhivery.com`, with real AWBs issued and
  `courier.delhivery.live_write_to_production` audit rows behind them.
  **The lesson is about the DOCUMENTS, not the test.** This paragraph said
  "has never" for weeks after it had, and `docs/delhivery-go-live-test.md`
  read "not yet performed" for just as long. **Reason about the write posture
  from the DATABASE** — `courier.<code>_live_writes_enabled` and
  `courier.<code>_api_base_url`, both one query away — never from this file.
  A session concluded twice in one conversation that production was safe
  while it was manifesting real parcels, on the strength of prose exactly
  like this.

- **The nightly NDR sweep — ✅ BUILT, and CUR-10 was WIDENED to admit it
  rather than quietly broken.** `courier-ndr-runner` registers repeatable
  BullMQ jobs for the run, the UPL poll and the reconcile
  (`courier-ndr-runner/queue/ndr.queue.ts:43`), each keyed on its own cron
  setting — and each repeatable is REMOVED before being re-added, because
  they are keyed on `(name, pattern, tz)` and editing the cron would
  otherwise add a second nightly run rather than moving the first.
  **The invariant change is the part worth reading.** CUR-10 said outright
  that a courier write is "never fired from a lifecycle transition, a cron,
  or a customer-facing handler". A sweep that must run after 21:00 IST cannot
  be operator-triggered at the moment it has to happen, so rather than let a
  cron silently violate a written rule, the rule was widened DELIBERATELY and
  narrowly: a runner may fire courier writes only where an operator has
  enabled that write channel, behind the live-write guard, an explicit
  per-category auto list (default EMPTY) and a one-click kill switch. **A
  lifecycle transition and a customer-facing handler remain forbidden
  triggers.** Since 2026-09-29 both gates are also per seller, combined by
  `narrowNdrGate` so a seller override can only ever NARROW — ANDed on
  enabled, INTERSECTED against the global ceiling — because one seller row
  saying `true` would otherwise send vans on a night an operator had switched
  the runner off.


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

## A god-moded recipient never reaches the shipment — FIXED 2026-08-21

`OrderAdminOverrideService.forceMutate` can change `recipientName`,
`recipientPhoneE164` and the whole address block on the order. The
shipment's `dest*` snapshot is NOT updated, and nothing else updates it
either: `provisionFromSnapshot` fires only on entry to CONFIRMED and
no-ops while a non-cancelled shipment exists, and `AwbSupersedeService`
copies the destination from the OLD shipment, so every replacement
inherits the stale values forever.

The immutability is correct (ORD-6 / WMS-9) — the point of the snapshot
is that a later catalog or customer edit cannot restate what was
dispatched. The gap is that **god mode is the sanctioned way to fix a
genuinely wrong recipient, and it cannot fix the copy that actually
reaches the courier.** An admin who corrects a mistyped phone on a
PICKED order sees the order update, sees no error, and the parcel still
ships to the wrong number.

Found during the Delhivery go-live test, where a test-shaped consignee
had to be replaced and could not be.

Worth considering (NOT implemented — it narrows an invariant and wants
a deliberate decision): propagate recipient `fieldChanges` to a live
shipment that is still `CREATED` **and carries no `awbNumber`**. Such a
shipment has been communicated to nobody — no label printed, no courier
told — so its snapshot has made no external commitment yet. Once an AWB
exists the courier holds the address and the correction belongs at
`courier-ops`' `edit` endpoint instead, which is where it already lives.

**FIXED.** `forceMutate` now propagates recipient `fieldChanges` to the
shipment's `dest*` snapshot in the SAME transaction, via a guarded
`updateMany` restricted to `status=CREATED AND awbNumber IS NULL AND
supersededAt IS NULL` — a shipment nobody has been told about. The count
is returned as `shipmentsSynced` and recorded on the audit row; `0` on
a parcel that already carries an AWB is the correct answer and the
signal that the correction belongs at `courier-ops`' edit endpoint
instead. Five unit tests pin the mapping, the WHERE clause, the
no-recipient-change case, the already-has-AWB case and the audit
record.

## Inbound freight was billed per consignment, not per arrival — FIXED 2026-08-21

`inbound_freight_charges.consignment_id` was UNIQUE: one bill for the
whole consignment, split at record time over the India legs that existed
then. That assumed a consignment arrives once. It does not — `IN_FINAL`
is a list precisely because 300 units can leave Dhaka as 100 in August
and 200 in September, and `ConsignmentStatusService` already derives
"some landed, some still in BD" correctly. Only the billing missed it.

Under the old key BOTH choices lost money, silently:

- **Bill early** — the split ran over the units that had landed so far.
  The September units got no `inbound_freight_allocations` row, and the
  charge path skips a unit with no allocation (`if (!alloc) continue`),
  so they shipped **freight-free forever**. Worse, the forwarder's
  invoice for that second shipment could not be entered at all:
  `FREIGHT_ALREADY_RECORDED`.
- **Bill late** — freight is charged as a unit LEAVES, so any of the
  first 100 that sold before the bill existed were never charged either.

Neither errored. Both just under-billed.

**FIXED**: the key is now `goods_receipt_id UNIQUE` — one bill per
ARRIVAL, which is also how a forwarder actually invoices (per shipment,
not per commercial arrangement). `consignment_id` stays as a non-unique
FK for grouping. `record` takes the arrival and DERIVES the consignment
from it (two ids that must agree are two ids that can disagree), refuses
the BD intake (`FREIGHT_NOT_AN_ARRIVAL` — it never flew) and refuses an
uncounted arrival (`FREIGHT_ARRIVAL_NOT_COUNTED` — the split would run
over guesses). The admin modal now picks a shipment, showing its unit
count and marking ones already billed. Amortisation, attribution and
settlement are unchanged.

Found because a live consignment was standing in it: CN-2026-08-000003,
100 units landed in Kolkata and 201 still in Dhaka.

---

## Both sides may change a reseller order (2026-09-18) — what was left

The owner opened a reseller store's order to BOTH parties (CLAUDE.md
ORD-6, `docs/reseller-stores.md` "Both sides may change the order"). What
went in is complete for the decisions taken; these three are recorded
rather than guessed. **Two of the three are now closed (2026-09-19) —
items 2 and 3 below say what was built; item 1 is still open and is a
product question about the CSV format, not a wiring job.**

**1. DONE (2026-09-19) — a store's CSV re-upload patches its own order,
and the selling price is a COLUMN with a stated fallback.**

The product question this entry named — what a CSV row means by "the
retail" — was answered by the owner: the store's CSV carries a SELLING
PRICE column, and a row that leaves it blank takes the SUGGESTED RETAIL
the seller set for that store (RS-3). A row with neither is refused BY
NAME (`RESELLER_RETAIL_REQUIRED`), never priced at ₹0 and never derived
from the COD amount — that is one total over every line plus delivery,
less any advance, so splitting it back out would invent a price nobody
agreed and then snapshot it as if they had.

The rule lives in `ResellerOrderService.create` rather than in the CSV
worker, so the portal, the API key and the CSV all read the column the
same way; `CreateStoreOrderDto.retailUnitPriceInr` became optional to
carry it. The column is on the store template and in
`ORDER_CSV_ALIAS_MAP`, and is deliberately NOT in
`ORDER_CSV_STORE_REQUIRED_FIELDS` any more: demanding it made an
otherwise-valid file unmappable for a store that prices everything at
its seller's suggestion.

`OrderService.applyBulkPatch` still refuses a reseller order, and for
the reason this entry gave — it re-snapshots the line from the LIVE
catalogue with no reseller terms, which the table's CHECK refuses and
the money could not re-plan from. The store's CSV does not go through
it: `OrderCsvImportProcessorService.patchStoreOrder` routes the row to
`OrderService.edit` with the STORE's scope — the same call the store's
portal makes — so the line is re-termed by `ResellerOrderRetermService`
under the ORDER's own snapshot (a kept line keeps its transfer price and
range, a line whose SKU moved is priced from the store's catalogue and
refused when it has no price there), the money is re-planned under the
terms the order was PLACED on, and the seller is told. ORD-9 is now
whole for a store: new → place, DRAFT/PENDING_CONFIRMATION → patch,
CONFIRMED+ → error row. A row that changes nothing comes back
`NOTHING_TO_UPDATE` and is counted as skipped, not failed — the same
file uploaded twice is the ordinary shape.

**2. A god-moded money change diverging silently — FIXED 2026-09-19.**

`OrderAdminOverrideService.forceMutate` can write `codAmountInr` and
`paymentMode` (both are in its whitelist), and it called the reseller
re-pricing NOWHERE. A forced COD left the order saying ₹1,500 while the
store's and the seller's credits were still worked out from ₹1,180, with
nothing said — and the stale figure is what a later delivery or payout
would pay.

The fix is the shape ORD-2 already uses for CC-6, the shipment, the
cancel-time refund and the lifecycle emit: ONE shared hook,
`OrderPostCommitHooksService.runForMoneyAffectingEdit`, which BOTH
writers of a money-affecting field call — `OrderService.edit` and god
mode. `MONEY_AFFECTING_ORDER_FIELDS` is declared there, so the two
cannot disagree about what "this moved the money" means.
`order-post-commit-hooks-shared.spec.ts` pins that both call it and
neither calls `recalculateAfterEdit` itself. God mode runs it BEFORE
`runForStatusChange`, because the lifecycle emit is what sets a credit
running and a plan corrected afterwards would be corrected only after
the stale figure had been paid.

God mode is NOT refused — that is its whole point, and WAL-8 already
settled that a forced status bills on purpose. What changed is that
where the money cannot follow, it is impossible to miss:

* `RESELLER_CREDIT_ALREADY_PAID` (and `RESELLER_CREDIT_HAS_NO_PLAN`)
  raise a HIGH MONEY system issue `reseller-money-diverged:<orderId>`
  naming the order, what each party was actually credited, and what to
  do — settle on the order's ticket (RS-7) or call it off and place it
  again. NEVER retried: a paid credit will be paid tomorrow too. It
  clears itself if a later recalculation ever succeeds.
* The refusal is also on the force's own response
  (`resellerMoney.refusal`) and rendered on the god-mode result panel,
  so the admin who caused it reads it there rather than on
  `/system-issues` a week later.
* BOTH parties are told, because neither of them made the change — the
  store by email (`store.order_changed_by_admin.email`; its own template
  rather than the seller's, since telling a store "your seller changed
  this" would send them to the wrong party), seller staff in-app under
  `seller.store_order_money_changed_by_admin`. The money line is the ONE
  wording, `describeMoneyOutcome`, shared with the ordinary edit notice.

Still open, and unchanged: the underlying "correct a paid reseller
order" flow. A CREDITED row is refused rather than reversed and
re-written because the ledger's once-per-order unique
(`seller_wallet_entries_once_per_order_uq`) would refuse the second
`cod_collection` a rewrite needs.

**DONE (2026-09-19) — the case BEHIND that refusal has an answer, and it
is the dispute Skydrop already referees.** A paid reseller order whose
figures are wrong is corrected through `TicketType.STORE_DISPUTE`'s
existing settlement (`POST /admin/tickets/:id/store-dispute-settlement`),
which moves money BETWEEN the store's wallet and the seller's as one
pair with no bank entry. No second credit, no weakened index, ONE money
path — the once-per-order unique stays exactly as it is, because it is
the guard against paying an order twice.

What the correction case ADDS is only what a settlement needs to be
argued from: `tickets.dispute_kind` (`GENERAL` | `FIGURE_CORRECTION`),
the raiser's CLAIM (`dispute_claim_amount_inr` +
`dispute_claim_payer` — what they say is owed and by whom, required on a
correction and refused on an ordinary dispute) and
`tickets.disputed_figures`, a snapshot of the order's money AS BOTH
SIDES SAW IT at the moment it was raised, taken from
`ResellerOrderMoneyReadService` — the same computation behind the
store's, the seller's and staff's own money panels, so the snapshot
cannot disagree with what either party was looking at, and the argument
stays legible after the live ledger has moved. Staff settle with their
own figure; the claim pre-fills the form.

**EITHER SIDE may raise it now.** The store already could
(`POST /store/tickets`); Seller staff could not, which made "we disagree
about this order" a one-directional right when both sides see the same
figures and both can be wrong about them.
`POST /seller/tickets/store-disputes` is the other half, and the STORE
is read off the ORDER rather than named in the request, so a seller
cannot file against a store that had nothing to do with it. The seller
raises it from the order's own money panel ("Raise with the store"),
which is where the numbers being disputed are on screen.

`settlement-bank-invariant.spec.ts` carries the scenario: a correction
settling AFTER both credits were paid moves the two wallets in opposite
directions by exactly the settled amount, leaves the bank book, capital
and `held for a seller` untouched (the money stays inside the seller's
group), and `held = max(0, seller wallet + Σ their store wallets)` holds
after every step — including when the payer goes negative, which is the
group's exposure and never cash we invent an entry for.

`repricePrepaidDebit`'s `STORE_BALANCE_INSUFFICIENT` guard is now
REACHABLE (god mode can force a confirmed prepaid order's payment mode),
and it is treated as retryable rather than a divergence — a store that
tops up fixes it, which is exactly what the sweep below is for.

**3. A recalculation that fails leaving the edit standing — FIXED
2026-09-19.** The ordering was right and stays right: the edit has
committed, so the re-pricing swallows its failure (the edit is the
durable fact, the money is its reflection). What was wrong is that the
only trace was a HIGH `reseller_order.money_recalculation_failed` audit
row, and nothing reads audit rows.

The audit row is KEPT — it is the history. It is no longer the alarm.
A failure now raises a HIGH MONEY `reseller-money-stale:<orderId>`, and
`OrderAttentionService.checkStaleResellerMoney` (hourly, unconditional —
this has nothing to do with the NSA switch) asks again for every one
still open, through `OrderWriteService.retryResellerMoneyRecalculation`
→ the SAME shared hook, so a retry cannot price it differently from the
original attempt. A success clears it; a failure bumps it; a failure
that turns out to be unrecoverable swaps it for the divergence above.

**The open issues ARE the worklist.** Nothing on the order records "this
still needs pricing", and a column for it would be a second source of
truth for what the issue already states (the CNS-2 / BIN-1 rule). Both
raise and sweep, deliberately: the failure is known only at the moment
it happens, so a sweep alone would have nothing to look at, and a raise
alone would leave a transient blip as a permanent row somebody has to
close by hand — which is how people learn to close issues without
acting.
