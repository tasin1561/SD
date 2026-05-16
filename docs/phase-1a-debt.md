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

## Pricing & Multi-Currency (Modules 15–17)

- **Historical FX rate tracking**. Phase 1A keeps a single current rate
  per currency pair; historical conversions use the as-of-then rate
  recorded on the order. Full historical FX rate timeseries deferred to
  Phase 1B.
  **Pick up:** Phase 1B with the remittance/wallet work.
