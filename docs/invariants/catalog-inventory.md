# Catalog and inventory (INV-*)

> Moved verbatim from `CLAUDE.md` on 2026-10-20 (split into `docs/invariants/`). The `<!-- from CLAUDE.md … -->` markers record where each block sat; the text below them is unchanged.

<!-- from CLAUDE.md lines 649-693 · Database -->
**Catalog rules (Module 4):**
1. **CatalogReadService is the only sanctioned path for cross-module variant reads.** Downstream modules (Inventory, Orders, Shipments, Couriers) MUST import `CatalogReadService` via NestJS DI. Never query `ProductVariant` directly from outside the catalog modules. Property resolution (effective weight, dims, value, HS, GST) is centralized there.
2. **Property inheritance order:** variant.field → product.defaultField → system_settings (GST only). Other properties have no system fallback — null all the way down = validation error. **Categories were removed 2026-08-01** — they sat between product and system_settings for `hsCode`/`gstRate` only, and both survived without them. **`hsCode` itself was removed 2026-08-18** (variant, product default, and the order/shipment snapshots): optional everywhere, absent from every production row, and printed as `—` on every invoice. HSN is required on an Indian GST invoice above the turnover thresholds, so if it comes back it belongs on the invoice line, not as a field each seller types per variant.
3. **Variant attributes are FREE-FORM.** `product_variants.attributes` is an unvalidated JSON map. The schema that validated it was category-scoped and went with categories (2026-08-01). Note this is strictly MORE permissive than before, not less: with no category the effective set was empty and the validator rejected every key as unknown, so an uncategorised product could not carry attributes at all.
4. **Image lifecycle:**
   - Registered: row alive, Spaces object alive
   - Soft-deleted: `row.deletedAt` set, object preserved (recoverable)
   - Hard-deleted (Phase 2 cron): row gone, object deleted together
   - Never registered (orphan): no row → object > 24h → cleaned by orphan cron (skips `thumbnails/` prefix)
5. **Presigned URL security:** key path must match `sellers/{sellerId}/variants/{variantId}/{token}.{ext}`; service validates seller segment matches authenticated seller; HEAD verifies object exists and size matches before registering.
5b. **A product picture beside a line on ANY screen comes from `CatalogReadService.thumbnailUrlsByVariant` / `displayInfoByVariant`** (2026-09-13) — one batched query for every line, the thumbnail key preferred via `displayImageKey`, presigned inside the handler that already authorised the read, and never stored. Call centre, order detail and the RTO inspect screen use it; a lookup failure costs the picture, never the screen (fail-open). The client renders it with `ProductThumb` from `@skydrop/ui/components`. Do not query `product_images` from another module for this (goods receipt still does — a known exception, not a pattern to copy).
6. **CSV re-upload PATCH semantics:** CSV-provided cells overwrite; omitted/blank cells do not null out existing values. Dedup by `(sellerId, externalRef)` for products, `(sellerId, skuCode)` for variants.
7. **Archive vs delete:** ARCHIVED status blocks new uses (orders, stock receiving) — enforce in service layer; `deletedAt` makes the row invisible in read paths. Both preserve historical references.

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
