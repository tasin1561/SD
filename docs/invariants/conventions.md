# Code conventions, module patterns, testing, MUST list 1-18

> Moved verbatim from `CLAUDE.md` on 2026-10-20 (split into `docs/invariants/`). The `<!-- from CLAUDE.md … -->` markers record where each block sat; the text below them is unchanged.

<!-- from CLAUDE.md lines 757-836 · Conventions -->
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


<!-- from CLAUDE.md lines 850-871 · MUST / MUST NOT -->
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
