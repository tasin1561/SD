# Skydrop — Database Schema (Phase 1A)

> **Canonical reference.** This document is the single source of truth for Skydrop's database schema. The Prisma schema in `packages/db/prisma/schema.prisma` implements what's documented here. If they diverge, this document wins — update Prisma to match, not the other way around.

**Status:** Design locked, awaiting implementation.
**Total tables:** 65 across 9 layers.
**Database:** PostgreSQL 18 with TimescaleDB extension.
**ORM:** Prisma.

---

## Schema-wide Conventions

These rules apply to **every** table unless explicitly noted otherwise.

### Primary keys
- Type: `String @id @default(dbgenerated("uuidv7()")) @db.Uuid`
- Postgres 18's native `uuidv7()` function — sortable, time-ordered, no app-side generation
- Composite PKs only for TimescaleDB hypertables (Postgres requires partition column in PK)

### Timestamps
- `createdAt   DateTime @default(now()) @map("created_at") @db.Timestamptz`
- `updatedAt   DateTime @updatedAt @map("updated_at") @db.Timestamptz`
- `deletedAt   DateTime? @map("deleted_at") @db.Timestamptz` — for soft-deletable tables
- All times are UTC. Display timezone is a per-user/seller preference.

### Naming
- **Folder/file:** `kebab-case`
- **Prisma models:** `PascalCase` singular (`Shipment`, `TrackingEvent`)
- **DB tables:** `snake_case` plural (`shipments`, `tracking_events`), via `@@map`
- **Columns:** `snake_case` via `@map`
- **Enums in Prisma:** `PascalCase` (`OrderStatus`)
- **Enum values in DB:** `snake_case` via `@map` (e.g., `PENDING_CONFIRMATION` → `pending_confirmation`)

### Money
- Always stored as `Decimal` with explicit precision
- Canonical currency: **INR** (`@db.Decimal(12, 2)` — handles up to ₹9,999,999,999.99)
- BDT is display-only via FX conversion
- For accounting precision (FX rates, cost tracking): `@db.Decimal(20, 6)` or `@db.Decimal(12, 6)`
- Cost tracking that needs to avoid float (e.g., per-SMS cost): store as `Int` in micros (1 INR = 1,000,000 micros)

### Phone numbers
- E.164 format always: `+91xxxxxxxxxx`, `+880xxxxxxxxxx`
- Stored as `String` (not int — leading + and zeros matter)
- Validated at app boundary, stored normalized

### Foreign keys
- Indexed by default (every FK column gets `@@index`)
- `onDelete: Cascade` only when child rows are meaningless without parent (e.g., `OrderItem` without `Order`)
- Otherwise default behavior: prevent delete if children exist (soft delete the parent instead)

### Soft delete
- Default for user-facing data (sellers, orders, products, etc.)
- Implemented via `deletedAt` column + Prisma middleware filtering `deletedAt IS NULL`
- Hard delete for: tokens, sessions, transient queue/log data, immutable ledger rows (movements, tracking events)

### Indexes
- All FK columns
- All commonly-filtered columns (status, deletedAt, createdAt, etc.)
- Composite indexes for common query patterns (`@@index([sellerId, status])`)
- Time-range queries: include createdAt in composite index

---

## Layer Overview

| Layer | Tables | Purpose |
|---|---|---|
| 1 — Identity & Access | 13 | Auth, tokens, RBAC, audit, onboarding progress |
| 2 — Addresses & Locations | 5 | Polymorphic addresses, warehouse hierarchy |
| 3 — Catalog | 9 | Products, variants, categories, images, proposals, attribute defs, CSV |
| 4 — Inventory & WMS | 7 | Stock levels, movements, reservations, batches |
| 5 — Orders & Customers | 6 | Orders, items, customers, events |
| 6 — Call Center | 3 | Queue, attempts, agent config |
| 7 — Shipments & Tracking | 7 | Shipments, labels, tracking events |
| 8 — Couriers & Pricing | 9 | Couriers, credentials, rates, FX, charges |
| 9 — Notifications & Webhooks | 6 | Templates, logs, webhooks, settings |
| **Total** | **65** | |

---

# Layer 1 — Identity & Access (13 tables)

## staff_users
Admin, agents, warehouse staff. Has password auth, role.

**Key fields:**
- `email` (normalized lowercase) + `emailDisplay` (original case)
- `passwordHash` (bcrypt, cost 12)
- `role: StaffRole`
- `lastLoginAt`, `emailVerifiedAt` (both nullable timestamps — captures whether AND when)

**Indexes:** `email`, `role`, `deletedAt`

**StaffRole enum:**
- `SUPER_ADMIN`
- `SELLER_APPROVAL_ADMIN`
- `CALL_AGENT`
- `WAREHOUSE_STAFF`
- `MANUAL_PLACEMENT_ADMIN`
- `FINANCE` (Phase 1B)

## sellers
BD merchants. Identity + profile combined.

**Key fields:**
- `email` + `emailDisplay`, `passwordHash`
- `companyName`, `contactPersonName`, `phone` (E.164 +880…), `whatsapp`
- `status: SellerStatus` (PENDING, APPROVED, REJECTED, SUSPENDED)
- `approvedAt`, `approvedById` (FK staff_users)
- Bank details (Phase 1B remittance): `bankName`, `bankAccountName`, `bankAccountNumber`, `bankRoutingNumber`, `bankSwiftCode`
- Display: `displayCurrency: Currency` (INR/BDT), `displayLanguage` ("en"/"bn")
- `countryCode @default("BD")`
- `emailVerifiedAt`, `lastLoginAt` (both nullable — mirrors `staff_users`)
- Addresses moved to polymorphic `addresses` table (Layer 2) — not embedded here

**Indexes:** `email`, `status`, `deletedAt`, `approvedById`

## seller_invitations
Token-based invite-only signup.

**Key fields:**
- `email`, `token` (unique URL-safe), `invitedById`, `expiresAt`, `usedAt`, `sellerId` (populated when used)

**Indexes:** `token`, `email`, `expiresAt`

## staff_refresh_tokens / seller_refresh_tokens
JWT refresh tokens, hashed in DB.

**Key fields (both):**
- `tokenHash` (SHA-256 of plaintext token)
- `userAgent`, `ipAddress` (@db.Inet)
- `expiresAt`, `revokedAt`

**Indexes:** `<entity>Id`, `tokenHash`, `expiresAt`

## seller_api_keys
B2B programmatic access.

**Key fields:**
- `name`, `keyPrefix` (first 8 chars, displayable), `keyHash` (SHA-256)
- `lastUsedAt`, `expiresAt` (nullable = no expiry), `revokedAt`

**Indexes:** `sellerId`, `keyHash`, `revokedAt`

## staff_password_reset_tokens / seller_password_reset_tokens
Short-lived (30 min) reset tokens, hashed, single-use.

**Key fields:**
- `tokenHash`, `expiresAt`, `usedAt`, `ipAddress`

**Indexes:** `<entity>Id`, `tokenHash`, `expiresAt`

## staff_email_verification_tokens / seller_email_verification_tokens
Email change/verification.

**Key fields:**
- `tokenHash`, `email` (the email being verified — stored separately so it works for email-change flow), `expiresAt`, `usedAt`

**Indexes:** `<entity>Id`, `tokenHash`, `expiresAt`

## seller_notes
Admin notes about sellers (replaces simple `rejectionReason` field).

**Key fields:**
- `sellerId`, `authorId` (staff_user), `content` (text)
- `category: SellerNoteCategory` (GENERAL, REJECTION_REASON, ONBOARDING, COMPLIANCE, COMPLAINT, PAYMENT)
- `isPinned`

**Indexes:** `sellerId`, `authorId`, `category`, `deletedAt`

## audit_logs
Cross-entity audit trail for sensitive actions.

**Key fields:**
- `actorType: ActorType` (STAFF, SELLER, SYSTEM, API)
- `actorId` (generic, nullable for system)
- `staffUserId` (typed FK for common case)
- `sellerId` (typed FK)
- `action` (string like "seller.approved", "order.cancelled")
- `entityType`, `entityId?` (the thing acted upon — null for actions not tied to a specific entity, e.g., login failures with unknown emails)
- `changes` (JSON before/after diff)
- `metadata` (JSON — IP, UA, request ID)

**Indexes:** `(actorType, actorId)`, `(entityType, entityId)`, `action`, `createdAt`

**ActorType enum:** `STAFF`, `SELLER`, `SYSTEM`, `API`

## seller_onboarding_progress
Per-seller tracker of the 8 Phase 1A onboarding steps. Initialized at
registration with all 8 rows; REGISTRATION_COMPLETED and
COMPANY_INFO_FILLED are auto-marked complete in the same transaction.
The remaining steps are marked by their respective flows (email
verification confirm, address creation, bank-details update, etc.).

**Key fields:**
- `sellerId` (FK, onDelete: Cascade — rows are meaningless without the seller)
- `stepCode: SellerOnboardingStep`
- `isRequired` (4 required, 4 optional in Phase 1A — see enum below)
- `completedAt?` (null = step not yet completed)
- `completedBy?: OnboardingStepActor` (who marked it — SYSTEM, SELLER, ADMIN)
- `metadata?` (JSON — e.g. `{ addressId }` for address-step completions)

**Constraints:** `@@unique([sellerId, stepCode])`
**Indexes:** `sellerId`, `stepCode`, `completedAt`

**Service-layer invariants (enforced in code, not the schema):**
1. `markStepComplete` is idempotent — re-marking a completed step is a
   no-op so that delete-and-recreate of an address doesn't reset the
   step timestamp.
2. The onboarding-complete email fires once: when the last required step
   transitions to complete, and only if no prior
   `seller.onboarding_complete.email` row exists in `notification_logs`
   for that seller.
3. Admin overrides use `completedBy = ADMIN` and the metadata captures
   the override reason + staff actor id.

## Shared enums (Layer 1)

- `StaffRole` — see staff_users above
- `SellerStatus` — `PENDING`, `APPROVED`, `REJECTED`, `SUSPENDED`
- `Currency` — `INR`, `BDT`
- `SellerNoteCategory` — see seller_notes above
- `ActorType` — see audit_logs above
- `SellerOnboardingStep` — `REGISTRATION_COMPLETED` (req),
  `EMAIL_VERIFIED` (req), `COMPANY_INFO_FILLED` (req),
  `BD_ORIGIN_ADDRESS_ADDED` (req), `IN_RETURN_ADDRESS_ADDED` (opt),
  `BD_OFFICE_ADDRESS_ADDED` (opt), `BANK_DETAILS_ADDED` (opt — Phase 1B),
  `NOTIFICATION_PREFS_REVIEWED` (opt)
- `OnboardingStepActor` — `SYSTEM`, `SELLER`, `ADMIN`

---

# Layer 2 — Addresses & Locations (5 tables)

## addresses
Polymorphic — owned by sellers, warehouses, orders, return hubs.

**Key fields:**
- `ownerType: AddressOwnerType`, `ownerId` (polymorphic FK — service-layer enforced)
- `label`, `contactName`, `contactPhone`, `contactEmail`
- `line1`, `line2`, `landmark`, `city`, `stateProvince`, `postalCode`, `countryCode` (@db.Char(2))
- `latitude`, `longitude` (@db.Decimal(10, 7))
- `type: AddressType` (BD_ORIGIN, BD_OFFICE, IN_RETURN, IN_WAREHOUSE, RECIPIENT)
- `isDefault`

**Indexes:** `(ownerType, ownerId)`, `(countryCode, postalCode)`, `deletedAt`

**AddressOwnerType enum:** `SELLER`, `WAREHOUSE`, `ORDER`, `RETURN_HUB`

**AddressType enum:** `BD_ORIGIN`, `BD_OFFICE`, `IN_RETURN`, `IN_WAREHOUSE`, `RECIPIENT`

## warehouses
Skydrop's IN warehouses (one in Phase 1A, table for expansion).

**Key fields:**
- `code` (unique, e.g., "BLR-01"), `name`, `status: WarehouseStatus`
- `countryCode @default("IN")`, `timezone @default("Asia/Kolkata")`

**Indexes:** `code`, `status`

**WarehouseStatus enum:** `ACTIVE`, `INACTIVE`, `MAINTENANCE`

## warehouse_zones
Logical zones within a warehouse.

**Key fields:**
- `warehouseId`, `code` (e.g., "A", "RTO"), `name`
- `pickOrder` (lower = picked first; default 100)
- `isActive`

**Constraints:** `@@unique([warehouseId, code])`
**Indexes:** `warehouseId`, `deletedAt`

## warehouse_bins
Discrete storage locations.

**Key fields:**
- `warehouseId`, `zoneId`
- `code` (full hierarchical: "A-1-2-03")
- `aisle`, `shelf` (nullable text — denormalized for pick-list grouping)
- `type: BinType`
- `maxWeightKg`, `maxVolumeCm3` (nullable — Phase 2 capacity caps)

**Constraints:** `@@unique([warehouseId, code])`
**Indexes:** `warehouseId`, `zoneId`, `aisle`, `type`, `deletedAt`

**BinType enum:** `STORAGE`, `PICKING`, `RECEIVING`, `PACKING`, `RTO_HOLD`, `DAMAGED`, `QUARANTINE`

## pin_codes
IN pincode cache (hybrid — grows organically + service area classification).

**Key fields:**
- `pinCode @id @db.VarChar(10)` (natural PK — pincode is unique)
- `countryCode`, `city`, `district`, `stateProvince`, `region`, `zone`
- `serviceArea: ServiceArea?` — for zone matrix lookups
- `serviceability: Json?` — courier-specific data: `{ "delhivery": { "serviceable": true, "cod": true, ...} }`
- `lastVerifiedAt`, `source: PinCodeSource`
- **No soft delete** — reference data, hard-overwrite

**Indexes:** `countryCode`, `city`, `stateProvince`, `zone`, `lastVerifiedAt`

**ServiceArea enum:** `METRO`, `TIER1`, `TIER2`, `REST`, `SPECIAL_NE`, `SPECIAL_JK`

**PinCodeSource enum:** `API_CACHE`, `MANUAL_IMPORT`, `USER_ENTERED`

---

# Layer 3 — Catalog (9 tables)

## categories
Global category tree with handling hints.

**Key fields:**
- `parentId` (self-FK, nullable — root has null)
- `slug` (unique), `name`, `fullPath` (denormalized: "Apparel > Men > T-Shirts")
- `depth` (0 = root), `sortOrder`
- `defaultPackageType: PackageType?`
- `requiresFragile`, `requiresColdChain`
- `defaultHsCode`, `defaultGstRate (@db.Decimal(5,2))`

**Indexes:** `parentId`, `depth`, `slug` (unique), `deletedAt`

**PackageType enum:** `BOX`, `POLYBAG`, `ENVELOPE`, `TUBE`, `CUSTOM`

## products
Conceptual products (seller-scoped).

**Key fields:**
- `sellerId`, `categoryId` (nullable)
- `name`, `description`, `brand`
- `externalRef` (seller's own product ID), `externalSku`
- `defaultWeightGrams`, `defaultLengthCm` / `WidthCm` / `HeightCm` (@db.Decimal(6,2))
- `defaultDeclaredValueInr (@db.Decimal(12,2))`, `defaultHsCode`
- `status: ProductStatus`

**Constraints:** `@@unique([sellerId, externalRef])`
**Indexes:** `sellerId`, `categoryId`, `status`, `deletedAt`

**ProductStatus enum:** `ACTIVE`, `ARCHIVED`, `DRAFT`

## product_variants
The actual SKUs. **THE most-referenced table — what stock and orders track.**

**Key fields:**
- `productId`, `sellerId` (denormalized for seller-scoped queries)
- `skuCode`
- `attributes: Json?` — flexible per-category (size/color/etc.)
- `variantLabel` (short human-readable)
- Physical overrides: `weightGrams`, `lengthCm`/`WidthCm`/`HeightCm`, `declaredValueInr` — nullable, fall back to product/category defaults
- `hsCode`, `gstRate` (override category defaults)
- `barcode` (indexed for warehouse scanning)
- `externalSku` (seller's variant code if different from skuCode)
- `status: VariantStatus`

**Constraints:** `@@unique([sellerId, skuCode])` — sellers' SKU codes unique within their account
**Indexes:** `productId`, `sellerId`, `barcode`, `status`, `deletedAt`

**VariantStatus enum:** `ACTIVE`, `ARCHIVED`, `OUT_OF_STOCK`

## product_images
Multiple per variant, primary flag.

**Key fields:**
- `variantId`
- `spacesKey`, `spacesBucket @default("skydrop-storage")`, `url`, `thumbnailUrl`
- `mimeType`, `sizeBytes`, `widthPx`, `heightPx`
- `altText`, `isPrimary`, `displayOrder`
- `uploadedBySellerId`, `uploadedByStaffId`
- **Cascade delete from variant** (with BullMQ job for Spaces cleanup)

**Indexes:** `variantId`, `isPrimary`, `displayOrder`, `deletedAt`

## category_courier_rules
Per-category courier handling rules.

**Key fields:**
- `categoryId`, `courierCode` (denormalized — FK to couriers in Layer 8)
- `isAllowed`, `notes`, `metadata: Json?`

**Constraints:** `@@unique([categoryId, courierCode])`
**Indexes:** `courierCode`

## category_proposals
Seller-submitted requests to add a new category (Module 4). Sellers can't
create categories directly; they propose, an admin reviews. On approval a
real `categories` row is created and linked back via `resultingCategoryId`.

**Key fields:**
- `sellerId` (FK seller), `proposedName`, `proposedSlug`, `rationale`
- `proposedParentId?` — bare UUID, NOT a Prisma relation (a proposal is a
  loosely-coupled request; the parent may be restructured before review).
  Mirrors the `category_courier_rules.courierCode` denormalized precedent.
- `reviewedByStaffId?` — bare UUID (same rationale, not a relation)
- `status: CategoryProposalStatus` (PENDING, APPROVED, REJECTED, WITHDRAWN)
- `reviewedAt?`, `decisionNote?`
- `resultingCategoryId?` — relation to `categories` (set on approval)

**Indexes:** `(sellerId, status)`, `status`, `proposedParentId`, `deletedAt`

**CategoryProposalStatus enum:** `PENDING`, `APPROVED`, `REJECTED`, `WITHDRAWN`

## category_attribute_definitions
Per-category attribute schema (Module 4). Variants under a category must
satisfy the effective attribute set (this category's defs + all inherited
from ancestors, child overrides parent on same `attributeKey`).

**Key fields:**
- `categoryId` (FK category), `attributeKey`, `displayLabel`
- `valueType: AttributeValueType` (STRING, NUMBER, BOOLEAN, ENUM)
- `allowedValues String[]` (used when valueType=ENUM)
- `isRequired`, `displayOrder`

**Constraints:** `@@unique([categoryId, attributeKey])`
**Indexes:** `categoryId`, `deletedAt`

**AttributeValueType enum:** `STRING`, `NUMBER`, `BOOLEAN`, `ENUM`

## seller_csv_mappings
Saved column-mapping presets for a seller's CSV imports (Module 4). Lets a
seller re-use the header→field mapping for their spreadsheet format.

**Key fields:**
- `sellerId` (FK seller), `name`, `importType: CsvImportType`
- `columnMap: Json` (catalog-field → CSV-header map; layered over
  auto-detection and under any explicit per-request override)
- `isDefault`, `lastUsedAt`

**Indexes:** `(sellerId, importType)`, `(sellerId, isDefault)`, `deletedAt`

**CsvImportType enum:** `PRODUCT_VARIANT` (forward-compatible; only value in 1A)

## bulk_product_uploads
One row per CSV product/variant import job (Module 4). Tracks the uploaded
file in Spaces, async processing status, and per-outcome counts. Reuses the
shared `BulkUploadStatus` enum (Layer 5).

**Key fields:**
- `sellerId` (FK seller), `mappingId?` (bare UUID), `fileName`, `spacesKey`,
  `fileSizeBytes`, `rowCount?`
- `status: BulkUploadStatus` (PENDING…COMPLETED_WITH_ERRORS…)
- `errorReportKey?` (Spaces key of generated error CSV)
- counts: `productsCreated/Updated`, `variantsCreated/Updated`,
  `rowsFailed`, `rowsSkipped`
- `jobId?` (BullMQ), `startedAt?`, `completedAt?`
- `uploadedBySellerId?`, `uploadedByStaffId?` (bare UUIDs)
- **No soft delete** — upload jobs are transient operational records

**Indexes:** `sellerId`, `status`, `createdAt`

---

# Layer 4 — Inventory & WMS (9 tables)

> **Module 5 schema deltas (applied):**
> - **New table `stock_alert_state`** — low-stock alert state at the
>   `(seller, variant, warehouse)` grain. Deliberately NOT on
>   `stock_levels`: availability/threshold are evaluated per
>   `(seller,variant,warehouse)` while `stock_levels` is per bin×batch and
>   those rows are pruned at qty 0 (state would be lost/ambiguous).
> - **New table `stock_adjustment_lines`** — persists a PENDING
>   adjustment's intended change so the executor can replay it on approval
>   (`stock_adjustments` itself has no target columns).
> - **New columns:** `sellers.default_low_stock_threshold`,
>   `sellers.reservation_ttl_hours_override`,
>   `product_variants.low_stock_threshold`. (`stock_levels` did NOT gain
>   alert columns — see `stock_alert_state`.)

## stock_batches
Receivable batches with optional expiry.

**Key fields:**
- `sellerId`, `variantId`, `warehouseId`
- `batchCode` (unique-per-seller), `sellerBatchRef` (seller's own lot number)
- `manufacturedAt`, `expiresAt`
- `unitCostInr`, `unitCostBdt` (Phase 1B optional)
- `status: BatchStatus`
- `initialQty` (immutable — original intake)
- `receivedAt`, `receivedById`, `receivingNoteId`

**Constraints:** `@@unique([sellerId, batchCode])`
**Indexes:** `(sellerId, variantId)`, `variantId`, `warehouseId`, `expiresAt`, `status`, `deletedAt`

**BatchStatus enum:** `ACTIVE`, `DEPLETED`, `EXPIRED`, `RECALLED`

## stock_levels
Denormalized current state per (seller × variant × bin × batch).

**Key fields:**
- `sellerId`, `variantId`, `warehouseId`, `binId`, `batchId`
- `qtyOnHand`, `qtyReserved`
- `version` (optimistic concurrency)
- **No soft delete** — zero out and prune

**Constraints:** `@@unique([sellerId, variantId, warehouseId, binId, batchId])`
**Indexes:** `(sellerId, variantId)`, `(warehouseId, binId)`, `variantId`, `batchId`, `qtyOnHand`

**Future:** Optionally add `qtyAvailable INT GENERATED ALWAYS AS (qty_on_hand - qty_reserved) STORED` in a later migration.

## stock_movements
**APPEND-ONLY LEDGER. TimescaleDB hypertable. Source of truth for stock.**

**Composite PK:** `@@id([id, createdAt])` (TimescaleDB requirement)

**Key fields:**
- `sellerId`, `variantId`, `warehouseId`, `binId`, `batchId`
- `type: StockMovementType`
- `qtyChange` (signed), `qtyBefore`, `qtyAfter` (snapshots)
- `actorType`, `actorId` (who did it)
- `reason` (free text), `reasonCode: StockMovementReasonCode?`
- Linked entities: `orderId`, `orderItemId`, `shipmentId`, `adjustmentId`
- Transfer-specific: `transferGroupId`, `fromBinId`, `toBinId`
- `metadata: Json?`
- **No updatedAt, no deletedAt** — immutable

**Indexes:** `(sellerId, variantId, createdAt)`, `(warehouseId, binId, createdAt)`, `batchId`, `orderId`, `shipmentId`, `(type, createdAt)`, `createdAt`

**StockMovementType enum:** `RECEIVING`, `PUT_AWAY`, `PICK`, `PACK_CONFIRM`, `DISPATCH`, `RETURN_RECEIVE`, `RETURN_RESTOCK`, `ADJUSTMENT_INCREASE`, `ADJUSTMENT_DECREASE`, `TRANSFER_OUT`, `TRANSFER_IN`, `CYCLE_COUNT_ADJUST`, `EXPIRY_WRITE_OFF`

**StockMovementReasonCode enum:** `DAMAGED_ON_ARRIVAL`, `DAMAGED_IN_WAREHOUSE`, `LOST`, `FOUND_EXTRA`, `CUSTOMER_REFUSED`, `ADDRESS_INVALID`, `EXPIRED`, `RECALLED`, `COUNTING_ERROR`, `OTHER`

## stock_reservations
Claims on stock.

**Key fields:**
- `sellerId`, `variantId`, `warehouseId`
- `binId`, `batchId` (nullable — populated when allocated)
- `qtyReserved`
- `orderId`, `orderItemId`
- `status: ReservationStatus`
- `expiresAt` (optional auto-release)
- `releasedAt`, `fulfilledAt`, `releaseReason: ReservationReleaseReason?`

**Indexes:** `(sellerId, variantId, status)`, `orderId`, `orderItemId`, `(status, expiresAt)`, `(binId, batchId)`

**ReservationStatus enum:** `ACTIVE`, `FULFILLED`, `RELEASED`

**ReservationReleaseReason enum:** `ORDER_CANCELLED`, `CALL_CANCELLED`, `ORDER_REJECTED_BY_COURIER`, `EXPIRED`, `MANUAL_RELEASE`, `STOCK_REALLOCATED`, `OTHER`

## stock_adjustments
Manual corrections with approval workflow.

**Key fields:**
- `sellerId`, `warehouseId`
- `type: AdjustmentType`, `reasonCode: StockMovementReasonCode`
- `description`
- `initiatedById`, `initiatedAt`
- `status: AdjustmentStatus`, `approverThresholdInr`, `approvedById`, `approvedAt`, `rejectedReason`
- `photoSpacesKeys: String[]`
- `totalValueImpactInr`

**Indexes:** `sellerId`, `warehouseId`, `status`, `type`, `initiatedAt`

**AdjustmentType enum:** `INCREASE`, `DECREASE`, `TRANSFER`, `CYCLE_COUNT`

**AdjustmentStatus enum:** `PENDING`, `APPROVED`, `REJECTED`, `EXECUTED`

## stock_adjustment_lines  *(Module 5)*
The intended per-target change(s) of an adjustment. Persisting these lets
an above-threshold PENDING adjustment be replayed by the executor on
approval (and a below-threshold one auto-execute in one tx). One line per
`(variant, bin, batch)` target; cycle-count reconciliation creates a
single-line adjustment per discrepancy, manual adjustments may be
multi-line.

**Key fields:**
- `adjustmentId` (FK `stock_adjustments`, **cascade delete**)
- `variantId`, `binId` (bare scalar UUIDs — loosely-coupled-ref precedent,
  like `category_proposals.proposedParentId`), `batchId?`
- `qtyChange` (signed; sign agrees with the parent type — INCREASE>0,
  DECREASE<0)
- `unitCostInr?` — RESOLVED cost snapshot (line input → `batch.unitCostInr`)
  used for `totalValueImpactInr` and historical accuracy

**Indexes:** `adjustmentId`, `variantId`, `binId`, `batchId`

## stock_alert_state  *(Module 5)*
Low-stock alert state machine (INV-9) at the `(seller, variant,
warehouse)` grain. One row per grain; survives `stock_levels` pruning;
single source of truth for fired/cleared/cooldown.

**Key fields:**
- `sellerId`, `variantId`, `warehouseId`
- `wasAlertActive` (Boolean, default false)
- `lowStockAlertSentAt?` — last fire time; drives the cooldown gate
  (`ops.stock_alert_cooldown_hours`), kept across CLEAR

**Constraints:** `@@unique([sellerId, variantId, warehouseId])`
**Indexes:** `(sellerId, variantId)`, `variantId`, `warehouseId`

## Module 5 columns on existing tables
- `sellers.default_low_stock_threshold (Int?)` — per-seller default
  low-stock threshold (variant override wins).
- `sellers.reservation_ttl_hours_override (Int?)` — per-seller reservation
  TTL override (else `ops.stock_reservation_ttl_hours`, else 48).
- `product_variants.low_stock_threshold (Int?)` — per-variant threshold;
  inventory-owned scalar surfaced cross-module via `CatalogReadService`
  (raw passthrough, not inheritance-resolved) so MUST #13 holds.

## cycle_counts + cycle_count_items
Periodic physical verification.

**cycle_counts key fields:**
- `warehouseId`, `zoneId?`
- `countType: CycleCountType`, `countDate`
- `initiatedById`, `status: CycleCountStatus`
- `startedAt`, `completedAt`
- Summary stats: `totalBinsCounted`, `totalSkusCounted`, `discrepancyCount`, `totalDiscrepancyValueInr`

**cycle_count_items key fields:**
- `cycleCountId` (cascade), `variantId`, `binId`, `batchId?`
- `systemQty`, `countedQty` (discrepancy computed in app)
- `countedById`, `countedAt`, `notes`
- `adjustmentId?` (link to resolution adjustment)

**CycleCountType enum:** `FULL`, `ZONE`, `SAMPLE`, `SKU_TARGETED`, `ABC_CLASSIFICATION`

**CycleCountStatus enum:** `SCHEDULED`, `IN_PROGRESS`, `COMPLETED`, `CANCELLED`

## goods_receipts + goods_receipt_lines
Inbound stock receiving documents.

**goods_receipts key fields:**
- `sellerId`, `warehouseId`
- `receiptNumber` (unique, "GR-2026-05-0001")
- `expectedArrivalAt`, `sellerReference`, `expectedSkus: Json?`
- `receivedAt`, `receivedById`
- `status: GoodsReceiptStatus`
- `hasDiscrepancies`, `discrepancyNotes`
- `photoSpacesKeys: String[]`

**goods_receipt_lines key fields:**
- `receiptId` (cascade), `variantId`, `batchId?`
- `expectedQty`, `receivedQty`, `damagedQty`
- `unitCostInr`, `manufacturedAt`, `expiresAt`
- `putawayBinId`

**GoodsReceiptStatus enum:** `PENDING`, `ARRIVING`, `COMPLETED`, `DISCREPANCY`, `CANCELLED`

---

# Layer 5 — Orders & Customers (6 tables)

## customers
End customers (Indian recipients). **Per-seller** phone-keyed identity dedup
(Module 6). Identity is `(sellerId, phoneE164)`.

**Key fields:**
- `sellerId` (FK → sellers, ON DELETE RESTRICT) — customer scoped to one seller
- `phoneE164` — primary identity *within a seller* (not globally unique)
- `name`, `email`, `altPhoneE164`
- Aggregates: `totalOrdersCount`, `successfulOrdersCount`, `rtoCount`, `refusedCount`, `fakeOrdersCount` (per-seller)
- `riskLevel: CustomerRiskLevel`, `riskNotes`
- `preferredLanguage @default("en")` ("en"/"hi")
- `firstOrderAt`, `lastOrderAt`

**Constraints:** `@@unique([sellerId, phoneE164])`
**Indexes:** `sellerId`, `phoneE164`, `riskLevel`, `lastOrderAt`, `deletedAt`

> **Module 6 deviation:** the pre-M6 canonical design was a GLOBAL phone-keyed
> customer with cross-seller risk aggregation (rtoCount/fakeOrdersCount/
> riskLevel shared across sellers). Deliberately narrowed to per-seller for
> Phase 1A privacy; cross-seller risk aggregation deferred (see phase-1a-debt).

**CustomerRiskLevel enum:** `NONE`, `LOW`, `MEDIUM`, `HIGH`, `BLOCKED`

## orders
Central order record.

**Key fields:**
- `orderNumber` (unique, "SD-2026-05-000001")
- `sellerId`, `customerId?` (resolved via phone on save)
- `sellerOrderRef` (seller's own ID; unique scoped to seller)
- `source: OrderSource`, `bulkUploadId?`
- **Recipient (immutable snapshot):** `recipientName`, `recipientPhoneE164`, `recipientAltPhoneE164`, `recipientEmail`, `recipientAddressLine1/2`, `recipientLandmark`, `recipientCity`, `recipientStateProvince`, `recipientPostalCode`, `recipientCountryCode`
- **Economics:** `paymentMode: PaymentMode`, `codAmountInr`, `declaredValueInr`
- **Physical:** `totalWeightGrams`, `packageType`
- `status: OrderStatus` (26 values — see enum below)
- `isUrgent`, `isHighRisk`, `hasAdminOverride` (Module 6 god-mode flag — set once by `OrderAdminOverrideService.forceMutate()`, never cleared)
- Confirmation: `confirmedAt`, `confirmedById`, `cancellationReason`, `cancelledAt`, `cancelledById`
- Notes: `internalNotes`, `sellerNotes`, `callNotes` (latest summary)
- SLA: `slaDeadline`, `expectedDeliveryAt`
- `placedAt`

**Constraints:** `@@unique([sellerId, sellerOrderRef])`
**Indexes:** `(sellerId, status)`, `customerId`, `orderNumber`, `recipientPhoneE164`, `recipientPostalCode`, `(status, placedAt)`, `placedAt`, `confirmedAt`, `deletedAt`

**OrderSource enum:** `MANUAL`, `BULK_UPLOAD`, `API`, `ADMIN`

**PaymentMode enum:** `COD`, `PREPAID`

**OrderStatus enum (26 values):**
Pre-confirmation: `DRAFT`, `PENDING_CONFIRMATION`, `CALL_NO_RESPONSE`, `CALL_RESCHEDULED`
Post-confirmation: `CONFIRMED`, `OUT_OF_STOCK`, `CANCELLED`, `CANCELLED_BY_ADMIN`, `REJECTED`
Warehouse: `PENDING_PICK`, `PICKED`, `PACKED`, `PACK_FAILED`
Courier: `PENDING_DISPATCH`, `DISPATCHED`, `IN_TRANSIT`, `OUT_FOR_DELIVERY`, `DELIVERED`
Failed: `DELIVERY_FAILED`, `RTO_INITIATED`, `RTO_IN_TRANSIT`, `RTO_RECEIVED`, `RTO_RESTOCKED`, `RTO_DAMAGED`, `LOST_IN_TRANSIT`
Manual: `PENDING_MANUAL_PLACEMENT`

> Module 6 added `OUT_OF_STOCK` (reservation-fail landing at confirm —
> non-terminal; Module 7 retries → `CONFIRMED` or → `CANCELLED`) and
> `CANCELLED_BY_ADMIN` (admin sane-cancel + god-mode). The earlier
> "22 values" label was a stale miscount of an already-24-value list;
> it is now genuinely 26.

**OrderCancellationReason enum:** `CUSTOMER_REQUESTED`, `CUSTOMER_UNREACHABLE`, `FAKE_ORDER`, `WRONG_ADDRESS`, `OUT_OF_STOCK`, `HIGH_RISK_CUSTOMER`, `SELLER_REQUESTED`, `DUPLICATE_ORDER`, `NO_COURIER_AVAILABLE`, `OTHER`

## order_items
Line items with fulfillment-state quantities.

**Key fields:**
- `orderId` (cascade), `variantId`
- Snapshots: `skuCode`, `productName`, `variantLabel`, `imageUrl`
- `quantity`
- Physical (per-unit snapshots): `unitWeightGrams`, `unitDeclaredValueInr`
- Economic: `unitPriceInr`
- Fulfillment quantities: `qtyReserved`, `qtyPicked`, `qtyPacked`, `qtyShipped`, `qtyDelivered`, `qtyReturned`
- Customs: `hsCode`
- Pick context: `pickedBatchId`, `pickedBinId` (filled at pick time)

**Indexes:** `orderId`, `variantId`, `pickedBatchId`

## order_events
Order-specific timeline (audit + seller-visible).

**Key fields:**
- `orderId` (cascade)
- `type: OrderEventType`, `fromStatus?`, `toStatus?`
- `description`, `data: Json?`
- `actorType`, `actorId?`
- `isVisibleToSeller`

**Indexes:** `(orderId, createdAt)`, `type`, `toStatus`

**OrderEventType enum (21 values):** `CREATED`, `STATUS_CHANGED`, `NOTE_ADDED`, `CALL_LOGGED`, `STOCK_RESERVED`, `STOCK_RELEASED`, `PICKED`, `PACKED`, `COURIER_ASSIGNED`, `COURIER_REJECTED`, `MANUAL_PLACEMENT`, `AWB_GENERATED`, `DISPATCHED`, `TRACKING_UPDATE`, `DELIVERY_ATTEMPTED`, `DELIVERED`, `RTO_INITIATED`, `RTO_RECEIVED`, `RTO_RESTOCKED`, `ADJUSTMENT`, `CHARGE_ADDED`, `CHARGE_REMOVED`

## bulk_order_uploads
CSV upload tracking.

**Key fields:**
- `sellerId`, `fileName`, `spacesKey`, `fileSizeBytes`, `rowCount`
- `status: BulkUploadStatus`
- `errorReportKey` (CSV of failed rows in Spaces)
- Metrics: `ordersCreated`, `rowsFailed`, `rowsSkipped`
- `jobId` (BullMQ), `startedAt`, `completedAt`
- `uploadedBySellerId`, `uploadedByStaffId`

**Indexes:** `sellerId`, `status`, `createdAt`

**BulkUploadStatus enum:** `PENDING`, `PROCESSING`, `COMPLETED`, `COMPLETED_WITH_ERRORS`, `FAILED`, `CANCELLED`

## order_recipient_address_cache
Address-level risk aggregation (optional in Phase 1A).

**Key fields:**
- `customerId`, `addressHash` (normalized hash for dedup)
- Address fields (last seen): `line1`, `line2`, `landmark`, `city`, `stateProvince`, `postalCode`
- `firstSeenAt`, `lastSeenAt`, `seenCount`
- `rtoCountAtAddress`, `successfulCountAtAddress`

**Constraints:** `@@unique([customerId, addressHash])`
**Indexes:** `customerId`

---

# Layer 6 — Call Center (3 tables)

## call_queue_entries
Live worklist.

**Key fields:**
- `orderId` (unique — one entry per order, ever)
- `assignedAgentId?`, `assignedAt?`, `assignmentMethod: AssignmentMethod`
- `previousAgentIds: String[]` (don't bounce back)
- `priority` (int, default 100, higher = called first)
- `status: CallQueueStatus`
- `availableAt` (earliest pickable time)
- `scheduledAttempts`, `maxAttempts @default(3)`
- `closedAt`, `closureReason: QueueClosureReason?`

**Indexes:** `(assignedAgentId, status)`, `(status, availableAt, priority)`, `orderId`, `closureReason`

**CallQueueStatus enum:** `WAITING`, `ASSIGNED`, `IN_PROGRESS`, `SCHEDULED`, `CLOSED`

**AssignmentMethod enum:** `AUTO_ROUND_ROBIN`, `MANUAL`, `REASSIGNED`, `AGENT_PICKED`

**QueueClosureReason enum:** `ORDER_CONFIRMED`, `ORDER_CANCELLED`, `ORDER_REJECTED`, `MAX_ATTEMPTS_EXCEEDED`, `ORDER_DELETED`, `ADMIN_CLOSED`

## call_attempts
Append-mostly per-attempt log.

**Key fields:**
- `queueEntryId` (cascade), `orderId` (denormalized)
- `agentId`
- `startedAt`, `endedAt`, `durationSeconds` (manual in Phase 1A)
- `phoneE164` (which number was tried)
- `outcome: CallOutcome`, `outcomeNotes`
- Customer-stated: `customerSaidName`, `customerSaidAddress`, `customerVerifiedItems` (nullable boolean — three-state)
- Reschedule: `rescheduledFor`, `rescheduledReason`
- Fraud: `flaggedAsSuspicious`, `suspicionReason`
- **No updatedAt** (immutable)

**Indexes:** `queueEntryId`, `orderId`, `(agentId, startedAt)`, `outcome`, `startedAt`, `flaggedAsSuspicious`

**CallOutcome enum (15 values):**
- Successful: `CONFIRMED`, `CANCELLED_BY_CUSTOMER`, `RESCHEDULED`
- Issues: `ADDRESS_CORRECTION`, `ITEM_CORRECTION`
- Failed contact: `NO_ANSWER`, `BUSY`, `CALL_REJECTED`, `VOICEMAIL`, `WRONG_NUMBER`, `PHONE_DISCONNECTED`
- Quality: `LANGUAGE_BARRIER`, `TECHNICAL_ISSUE`
- Fraud: `FAKE_ORDER`
- `OTHER`

## agent_call_settings
Per-agent config (one row per agent).

**Key fields:**
- `agentId` (unique)
- Capacity: `maxActiveCalls @default(20)`
- `isAvailable`
- Hours: `workingHoursStart` ("09:00"), `workingHoursEnd` ("18:00"), `workingDays: Int[] @default([1,2,3,4,5,6])` (0=Sun, 6=Sat)
- `timezone @default("Asia/Kolkata")`
- `languages: String[] @default(["en", "hi"])`
- Specializations: `canHandleHighRisk`, `canHandleHighValue`
- Daily stats: `totalCallsToday`, `confirmedTodayCount` (reset nightly)

**Indexes:** `isAvailable`, `agentId`

---

# Layer 7 — Shipments & Tracking (7 tables)

## shipments
The physical parcel.

**Key fields:**
- `shipmentNumber` (unique, "SH-2026-05-000001")
- `courierCode` (FK to couriers Layer 8, string for forward-ref)
- `awbNumber` (unique, nullable until generated), `courierShipmentId`, `serviceType`
- `originWarehouseId`
- **Dest snapshot (immutable):** `destRecipientName`, `destRecipientPhoneE164`, `destAddressLine1/2`, `destLandmark`, `destCity`, `destStateProvince`, `destPostalCode`, `destCountryCode`
- **Physical:** `totalWeightGrams`, `declaredWeightGrams`, `actualWeightGrams`, `lengthCm`, `widthCm`, `heightCm`, `volumetricWeightGrams`, `chargeableWeightGrams`, `packageType`
- **Economics:** `declaredValueInr`, `codAmountInr`
- `status: ShipmentStatus`
- Timestamps: `awbGeneratedAt`, `pickedUpByCourierAt`, `firstScanAt`, `outForDeliveryAt`, `deliveredAt`, `rtoInitiatedAt`, `rtoReceivedAt`, `expectedDeliveryAt`
- Manual flow: `isManualCourier`, `supersedesShipmentId?` (self-FK for Delhivery→Bluedart chain)
- POD: `podPhotoSpacesKeys: String[]`, `podSignatureSpacesKey`, `podRecipientName`
- Quality: `hasIssue`, `estimatedCostInr`

**Indexes:** `(courierCode, status)`, `awbNumber`, `(status, createdAt)`, `destPostalCode`, `destRecipientPhoneE164`, `deliveredAt`, `rtoInitiatedAt`, `supersedesShipmentId`, `deletedAt`

**ShipmentStatus enum (16 values):**
- Pre-courier: `CREATED`, `AWB_PENDING`, `AWB_GENERATED`, `FAILED_AT_CREATION`
- In transit: `HANDED_TO_COURIER`, `IN_TRANSIT`, `AT_HUB`, `OUT_FOR_DELIVERY`, `DELIVERY_ATTEMPTED`
- Terminal happy: `DELIVERED`
- RTO: `RTO_INITIATED`, `RTO_IN_TRANSIT`, `RTO_DELIVERED`
- Bad: `LOST`, `DAMAGED`, `CANCELLED`

## order_shipments
Many-to-many junction.

**Key fields:**
- `orderId`, `shipmentId` (cascade from shipment)
- `isFullOrder @default(true)`
- `shipmentSequence @default(1)`

**Constraints:** `@@unique([orderId, shipmentId])`
**Indexes:** `orderId`, `shipmentId`

## shipment_items
Line items in each parcel.

**Key fields:**
- `shipmentId` (cascade), `orderItemId`
- `quantity` (may be < orderItem.quantity if split)
- Snapshots: `skuCode`, `productName`, `variantLabel`, `unitWeightGrams`, `unitDeclaredValueInr`, `hsCode`, `unitPriceInr`
- Pick context: `pickedBatchId`, `pickedBinId`

**Indexes:** `shipmentId`, `orderItemId`, `pickedBatchId`

## awb_labels
Versioned PDF labels.

**Key fields:**
- `shipmentId` (cascade)
- `version`, `isCurrent`
- `spacesKey`, `spacesBucket`, `url`, `fileSizeBytes`, `mimeType`
- `paperSize: LabelPaperSize`, `format`
- `generatedAt`, `generatedByStaffId`, `generatedReason: LabelGenerationReason`
- `printedCount`, `lastPrintedAt`

**Constraints:** `@@unique([shipmentId, version])`
**Indexes:** `(shipmentId, isCurrent)`, `generatedAt`

**LabelPaperSize enum:** `A4`, `A6`, `THERMAL_4X6`

**LabelGenerationReason enum:** `INITIAL`, `REPRINT_DAMAGED`, `AWB_REISSUED`, `FORMAT_CHANGED`, `MANUAL_REQUEST`

## tracking_events
**TimescaleDB HYPERTABLE. Append-only.**

**Composite PK:** `@@id([id, createdAt])`

**Key fields:**
- `shipmentId` (cascade)
- `eventType: TrackingEventType`, `status: ShipmentStatus`
- `description`
- Location: `locationName`, `locationCity`, `locationPincode`, `latitude`, `longitude`
- Source: `source: TrackingEventSource`, `courierCode`, `rawCourierStatus`
- Origin: `webhookId?`, `actorType?`, `actorId?`
- `metadata: Json?`
- `isVisibleToCustomer`
- **No updatedAt, no deletedAt** — immutable

**Indexes:** `(shipmentId, createdAt(sort: Desc))`, `eventType`, `source`, `webhookId`

**TrackingEventType enum (20 values):** `AWB_GENERATED`, `COURIER_PICKUP_SCHEDULED`, `COURIER_PICKUP_DONE`, `ARRIVED_AT_HUB`, `DEPARTED_HUB`, `IN_TRANSIT_UPDATE`, `ARRIVED_AT_DESTINATION_HUB`, `OUT_FOR_DELIVERY`, `DELIVERY_ATTEMPTED`, `DELIVERED`, `DELIVERY_FAILED`, `ADDRESS_ISSUE`, `CUSTOMER_REQUESTED_RESCHEDULE`, `CUSTOMER_REFUSED`, `RTO_INITIATED`, `RTO_IN_TRANSIT`, `RTO_DELIVERED`, `LOST`, `DAMAGED`, `STATUS_SYNC`, `MANUAL_UPDATE`

**TrackingEventSource enum:** `COURIER_WEBHOOK`, `COURIER_POLL`, `MANUAL_ENTRY`, `SYSTEM`, `CUSTOMER_REPORT`

## courier_webhooks
Raw incoming webhook payloads.

**Key fields:**
- `courierCode`, `shipmentId?`, `awbNumber?`
- `receivedAt`, `remoteIp`, `userAgent`, `signature`
- `httpMethod`, `endpoint`, `headers: Json`, `rawBody: Text`
- `parsedBody: Json?`
- `status: WebhookStatus`, `processedAt`
- `trackingEventId?` (link to resulting event)
- Errors: `errorMessage`, `errorStack`, `retryCount`, `nextRetryAt`
- `signatureValid?` (nullable boolean — three-state)

**Indexes:** `courierCode`, `shipmentId`, `awbNumber`, `receivedAt`, `status`, `(nextRetryAt, status)`

**WebhookStatus enum:** `RECEIVED`, `PROCESSED`, `IGNORED`, `FAILED`, `ABANDONED`

## delivery_attempts
Rich per-attempt records.

**Key fields:**
- `shipmentId` (cascade)
- `attemptNumber`
- `attemptedAt`
- `outcome: DeliveryAttemptOutcome`, `failureReason: DeliveryFailureReason?`, `failureNotes`
- `contactedCustomer`, `customerResponse`
- `nextAttemptScheduledAt`
- `attemptLatitude`, `attemptLongitude`
- `agentName`, `agentPhone` (courier's delivery agent)
- `source: TrackingEventSource`, `webhookId?`

**Constraints:** `@@unique([shipmentId, attemptNumber])`
**Indexes:** `shipmentId`, `outcome`, `failureReason`, `attemptedAt`

**DeliveryAttemptOutcome enum:** `SUCCESS`, `FAILED`, `RESCHEDULED`, `REFUSED`, `CANCELLED`

**DeliveryFailureReason enum:** `CUSTOMER_UNAVAILABLE`, `CUSTOMER_PHONE_UNREACHABLE`, `ADDRESS_NOT_FOUND`, `ADDRESS_INCOMPLETE`, `ADDRESS_OUT_OF_DELIVERY_AREA`, `CUSTOMER_REFUSED`, `PAYMENT_REFUSED`, `BAD_WEATHER`, `CUSTOMER_NOT_AVAILABLE_AT_TIME`, `DAMAGED_PACKAGE`, `OTHER`

---

# Layer 8 — Couriers & Pricing (9 tables)

## couriers
Registry of supported couriers.

**Key fields:**
- `code` (unique, "delhivery"/"bluedart"/"manual"), `name`, `displayName`
- `logoSpacesKey`
- `integrationType: CourierIntegrationType`
- `apiBaseUrl`, `webhookSecret`
- Capabilities: `supportsCod`, `supportsPrepaid`, `supportsRto`, `supportsWeightDispute`, `maxWeightGrams`, `maxDeclaredValueInr`, `maxCodAmountInr`
- `defaultServiceTypes: String[]`
- `volumetricDivisor @default(5000)`
- `isActive`, `priorityForRouting @default(100)`

**Indexes:** `code`, `isActive`, `priorityForRouting`, `deletedAt`

**CourierIntegrationType enum:** `API_FULL`, `API_TRACKING_ONLY`, `MANUAL`

## courier_credentials
Encrypted API credentials per courier × environment.

**Key fields:**
- `courierId`, `environment: CredentialEnvironment`
- `encryptedPayload: Text` (AES-256-GCM ciphertext, base64)
- `encryptionKeyVersion`
- `fieldNames: String[]` (non-sensitive metadata of which fields are inside)
- `isActive`, `expiresAt`
- `lastUsedAt`, `lastTestedAt`, `lastTestResult`
- `createdByStaffId`, `notes`

**Constraints:** `@@unique([courierId, environment, isActive])`
**Indexes:** `courierId`, `environment`, `isActive`, `deletedAt`

**CredentialEnvironment enum:** `SANDBOX`, `PRODUCTION`

**Encryption rules (service layer):**
- Key in env var `COURIER_CREDENTIALS_KEY_<version>`, never in DB
- AES-256-GCM with per-record IV
- Decrypt via `CourierCredentialsService.decrypt()` which writes audit log
- Plaintext never logged, never serialized to API responses
- Memory cache TTL 5min to avoid hammering audit

## rate_cards
Named rate card collections.

**Key fields:**
- `code` (unique), `name`, `description`
- `isDefault` (only one true at a time, app-enforced)
- `isActive`, `effectiveFrom`, `effectiveTo`
- `currency @default(INR)`
- `createdByStaffId`

**Indexes:** `code`, `isDefault`, `isActive`, `(effectiveFrom, effectiveTo)`, `deletedAt`

## rate_card_items
Actual rates: weight × zone × service × courier.

**Key fields:**
- `rateCardId` (cascade), `courierId`
- `serviceType` ("express"/"surface"/...)
- `zone` ("A"/"B"/...)
- `weightSlabFromGrams`, `weightSlabToGrams` (inclusive)
- `baseChargeInr`, `perKgChargeInr?`, `costToSkydropInr?`
- `isActive`

**Constraints:** `@@unique([rateCardId, courierId, serviceType, zone, weightSlabFromGrams])`
**Indexes:** `(rateCardId, courierId)`, `zone`, `(weightSlabFromGrams, weightSlabToGrams)`, `isActive`

## seller_pricing
Per-seller rate card assignment.

**Key fields:**
- `sellerId`, `rateCardId`
- `courierId?` (null = applies to all couriers)
- `discountPercent?`, `codFeePercent?` (overrides)
- `effectiveFrom`, `effectiveTo`
- `isActive`, `notes`, `approvedByStaffId`

**Indexes:** `(sellerId, isActive)`, `rateCardId`, `(effectiveFrom, effectiveTo)`, `deletedAt`

**Resolution order (service layer):**
1. Find active `seller_pricing` for `(sellerId, courierId)` → use its rateCardId
2. Else active `seller_pricing` for `(sellerId, null)` → use its rateCardId
3. Else global default rate card (`rate_cards.isDefault = true`)
4. Apply `discountPercent` if set

## zone_matrix_entries
Origin area × dest area → zone, per courier.

**Key fields:**
- `courierId`
- `originArea: ServiceArea`, `destArea: ServiceArea`
- `zone` (matches rate_card_items.zone)

**Constraints:** `@@unique([courierId, originArea, destArea])`
**Indexes:** `courierId`, `zone`

## surcharge_rules
Configurable additional fees.

**Key fields:**
- `rateCardId` (cascade)
- `type: SurchargeType`, `name`
- `computationMethod: SurchargeComputationMethod`
- `flatAmountInr?`, `percentage?` (use based on method)
- `minAmountInr?`, `maxAmountInr?`
- `baseField: SurchargeBaseField?` (for percentage)
- Conditional: `appliesOnlyIfPaymentMode?`, `appliesOnlyForServiceAreas: ServiceArea[]`
- Display: `isVisibleToSeller`, `displayOrder`
- `isActive`

**Indexes:** `rateCardId`, `type`, `isActive`, `deletedAt`

**SurchargeType enum:** `COD_FEE`, `FUEL_SURCHARGE`, `REMOTE_AREA_FEE`, `RTO_FEE`, `WEIGHT_DISPUTE_FEE`, `RESHIPMENT_FEE`, `ADDRESS_CORRECTION_FEE`, `OTHER`

**SurchargeComputationMethod enum:** `FLAT`, `PERCENTAGE`, `TIERED`

**SurchargeBaseField enum:** `SHIPPING_CHARGE`, `COD_AMOUNT`, `DECLARED_VALUE`, `CHARGEABLE_WEIGHT`

## fx_rates
Current FX rates only (no history in Phase 1A — Phase 1B adds historical).

**Key fields:**
- `fromCurrency: Currency`, `toCurrency: Currency`
- `rate (@db.Decimal(12, 6))`
- `source: FxRateSource`, `sourceUrl`
- `fetchedAt`
- `isManualOverride`, `overrideByStaffId`, `overrideReason`

**Constraints:** `@@unique([fromCurrency, toCurrency])`

**FxRateSource enum:** `EXCHANGERATE_HOST`, `OPEN_EXCHANGE_RATES`, `MANUAL`, `FALLBACK`

## order_charges
Per-order line items with full provenance.

**Key fields:**
- `orderId`, `shipmentId?`
- `type: ChargeType`
- `amountInr`
- Tax: `isTaxable`, `taxRate`, `taxAmountInr`, `totalAmountInr` (denormalized)
- `description`, `displayOrder`, `isVisibleToSeller`
- Provenance: `rateCardId?`, `surchargeRuleId?`
- `computationContext: Json?` (snapshot of inputs — weight, zone, rate, etc.)
- `status: OrderChargeStatus`

**Indexes:** `orderId`, `shipmentId`, `type`, `status`, `rateCardId`, `deletedAt`

**ChargeType enum:** `BASE_SHIPPING`, `COD_FEE`, `FUEL_SURCHARGE`, `REMOTE_AREA_FEE`, `RTO_FEE`, `WEIGHT_DISPUTE_FEE`, `RESHIPMENT_FEE`, `GST`, `ADJUSTMENT`, `REFUND`, `OTHER`

**OrderChargeStatus enum:** `ESTIMATED`, `CONFIRMED`, `FINAL`, `DISPUTED`, `ADJUSTED`

---

# Layer 9 — Notifications & Webhooks (6 tables)

## notification_templates
Admin-editable Jinja-style templates.

**Key fields:**
- `code` (e.g., "order.confirmed.customer.sms")
- `name`, `description`
- `channel: NotificationChannel`, `recipientType: NotificationRecipientType`
- `language @default("en")`
- `subject?`, `bodyTemplate: Text`, `htmlBodyTemplate?`
- `variables: Json?` (schema of expected placeholders)
- `preferredProvider?`
- `isActive`, `version`
- Throttling: `maxPerRecipientPerHour?`, `maxPerRecipientPerDay?`
- Audit: `lastEditedByStaffId`, `lastEditedAt`

**Constraints:** `@@unique([code, language])`
**Indexes:** `code`, `channel`, `recipientType`, `isActive`, `deletedAt`

**NotificationChannel enum:** `EMAIL`, `SMS`, `IN_APP`, `WHATSAPP` (future)

**NotificationRecipientType enum:** `CUSTOMER`, `SELLER`, `STAFF`, `ADMIN`

## notification_logs
Every send attempt.

**Key fields:**
- `templateId?` (nullable for orphan-handling), `templateCode`, `templateVersion`
- `channel`, `recipientType`, `recipientId?`
- Destinations: `toEmail?`, `toPhoneE164?`, `toInAppUserId?`
- Content: `subject?`, `body: Text`, `htmlBody: Text?`, `variables: Json?`
- Context: `orderId?`, `shipmentId?`, `callAttemptId?`, `triggerEvent`
- Provider: `provider`, `providerMessageId`
- `status: NotificationStatus`
- Lifecycle: `sentAt`, `deliveredAt`, `failedAt`
- Failures: `failureCode`, `failureMessage`
- `costMicros?` (int — micro-INR for cost tracking)
- Retries: `attemptNumber`, `parentNotificationId?`
- `readAt?`

**Indexes:** `(recipientType, recipientId)`, `orderId`, `shipmentId`, `status`, `providerMessageId`, `(templateCode, createdAt)`, `createdAt`

**NotificationStatus enum:** `QUEUED`, `SENDING`, `SENT`, `DELIVERED`, `READ`, `BOUNCED`, `FAILED`, `THROTTLED`, `CANCELLED`

## seller_webhook_endpoints
Seller-configured outbound webhooks.

**Key fields:**
- `sellerId`, `url`
- `secretKey` (plaintext — shared secret for HMAC)
- Rotation: `previousSecretKey`, `previousSecretKeyValidUntil`
- `subscribedEvents: String[]`
- `name`, `description`
- `isActive`
- Health: `lastSuccessAt`, `lastFailureAt`, `consecutiveFailureCount`
- Auto-disable: `autoDisabledAt`, `autoDisabledReason`
- Testing: `lastTestedAt`, `lastTestStatus`

**Indexes:** `(sellerId, isActive)`, `isActive`, `deletedAt`

## outbound_webhook_deliveries
Every webhook delivery attempt.

**Key fields:**
- `endpointId` (cascade)
- `eventType`, `eventId`
- `payload: Json`, `payloadVersion @default("v1")`
- `attemptNumber`, `maxAttempts @default(5)`
- Request: `httpMethod`, `requestUrl`, `requestHeaders: Json`, `signature`
- Response: `responseStatus`, `responseHeaders: Json?`, `responseBody: Text?`, `responseTimeMs`
- `status: WebhookDeliveryStatus`, `errorCode?`, `errorMessage?`
- Scheduling: `scheduledAt`, `sentAt`, `nextRetryAt`
- `parentDeliveryId?` (retry chain)

**Constraints:** `@@unique([endpointId, eventType, eventId, attemptNumber])`
**Indexes:** `(endpointId, status)`, `(status, nextRetryAt)`, `(eventType, eventId)`, `scheduledAt`, `sentAt`

**WebhookDeliveryStatus enum:** `SCHEDULED`, `IN_FLIGHT`, `DELIVERED`, `FAILED`, `ABANDONED`, `ENDPOINT_DISABLED`

**Retry policy (BullMQ):**
- Attempt 1: immediate
- Attempt 2: 30s after failure
- Attempt 3: 5m after
- Attempt 4: 30m after
- Attempt 5: 6h after
- After 5: ABANDONED, alert admin

## system_settings
Admin-editable runtime config.

**Key fields:**
- `key` (unique, hierarchical: "pricing.gst_rate")
- `category`
- `valueType: SettingValueType`
- Typed value columns: `valueString?`, `valueInt?`, `valueDecimal?`, `valueBoolean?`, `valueJson?`, `valueDate?` (only one used per row)
- UI metadata: `displayName`, `description`, `helpText`
- `validationSchema: Json?`
- Behavior: `isEditableByAdmin`, `isSensitive`, `requiresRestart`
- `lastEditedByStaffId`, `lastEditedAt`

**Indexes:** `key`, `category`

**SettingValueType enum:** `STRING`, `INT`, `DECIMAL`, `BOOLEAN`, `JSON`, `DATE`

## seller_notification_preferences
Per-seller, per-category channel + frequency prefs.

**Key fields:**
- `sellerId`, `category: SellerNotificationCategory`
- Channels: `emailEnabled`, `smsEnabled`, `inAppEnabled`, `webhookEnabled`
- `frequency: NotificationFrequency`
- Quiet hours: `quietHoursStart`, `quietHoursEnd`, `timezone @default("Asia/Dhaka")`

**Constraints:** `@@unique([sellerId, category])`
**Indexes:** `sellerId`

**SellerNotificationCategory enum:** `ORDER_UPDATES`, `SHIPMENT_UPDATES`, `STOCK_ALERTS`, `CALL_CENTER_OUTCOMES`, `BILLING` (Phase 1B), `SYSTEM_ANNOUNCEMENTS`, `MARKETING`

**NotificationFrequency enum:** `IMMEDIATE`, `HOURLY_DIGEST`, `DAILY_DIGEST`, `WEEKLY_DIGEST`, `DISABLED`

---

# Post-Migration SQL (TimescaleDB Setup)

After Prisma generates the initial migration with the standard tables, append the following SQL to the migration file (or run as a separate migration):

```sql
-- Enable extensions
CREATE EXTENSION IF NOT EXISTS timescaledb;
-- CREATE EXTENSION IF NOT EXISTS postgis;  -- defer until needed

-- Convert tracking_events to hypertable
SELECT create_hypertable(
  'tracking_events',
  'created_at',
  chunk_time_interval => INTERVAL '1 month',
  if_not_exists => TRUE
);

-- Compression for tracking_events
ALTER TABLE tracking_events SET (
  timescaledb.compress,
  timescaledb.compress_orderby = 'created_at DESC',
  timescaledb.compress_segmentby = 'shipment_id'
);

SELECT add_compression_policy(
  'tracking_events',
  INTERVAL '7 days',
  if_not_exists => TRUE
);

-- Convert stock_movements to hypertable
SELECT create_hypertable(
  'stock_movements',
  'created_at',
  chunk_time_interval => INTERVAL '1 month',
  if_not_exists => TRUE
);

-- Compression for stock_movements
ALTER TABLE stock_movements SET (
  timescaledb.compress,
  timescaledb.compress_orderby = 'created_at DESC',
  timescaledb.compress_segmentby = 'seller_id, variant_id'
);

SELECT add_compression_policy(
  'stock_movements',
  INTERVAL '30 days',
  if_not_exists => TRUE
);
```

**Why this approach:**
- Prisma generates standard tables first; TimescaleDB conversion runs after via raw SQL
- Hypertables present as regular tables to Prisma queries — no client-side changes
- Compression runs automatically on chunks past the threshold
- Retention: not configured (keep all data for audit); revisit at 3-year mark

---

# Service-Layer Rules

These rules belong in `CLAUDE.md` (and will be added when we update it post-schema). They enforce constraints that the schema alone cannot.

## Inventory rules

1. **Stock changes happen in transactions.** Every operation touching `stock_levels` must wrap all related writes (movements + level updates + reservations) in a single Postgres transaction.

2. **Optimistic concurrency on stock_levels.** Every update checks `version` column. On conflict, refetch and retry.

3. **Movements are immutable.** Application code never UPDATEs or DELETEs `stock_movements`. Compensating entries only.

4. **Reservation cleanup is async.** Hourly BullMQ job releases reservations past `expiresAt`. Don't release inline.

5. **FIFO/FEFO at pick time.** Pick query: `ORDER BY stock_batches.expiresAt ASC NULLS LAST, stock_batches.receivedAt ASC`.

## Order rules

1. **Status transitions need a state machine.** 22 statuses with valid transitions — implement in code (e.g., xstate or hard-coded transition map). Don't rely on DB.

2. **Sequential order numbers via Postgres SEQUENCE.** Create one per year for `SD-YYYY-NN-XXXXXX` format, or a single table-based counter with row-level locking.

3. **Recipient address is immutable on order.** Snapshot at create; never re-link to an Address row.

## Shipment rules

1. **Webhook idempotency.** Use `(courierCode, awbNumber, eventType, externalEventId)` as dedup key. Duplicate webhooks stored (audit) but produce no duplicate tracking events.

2. **Status transitions enforced in code.** 16 shipment statuses; transition map in service layer.

3. **AWB lifecycle: no transfers.** When superseded, new shipment gets its own AWB. Don't reassign.

4. **Webhook receipt acknowledged ASAP.** Endpoint: write raw row, return HTTP 200 within 500ms, process async via BullMQ.

## Credential rules

1. **Decryption key never in DB.** Always env var.
2. **Audit log on every decrypt.** `CourierCredentialsService.decrypt()` writes audit row before returning plaintext.
3. **Plaintext never logged, never serialized.** Memory cache max 5 min TTL.

## Pricing rules

1. **Calculate at order creation, not at display time.** Charges are persisted to `order_charges` with full `computationContext`.
2. **GST applies after all surcharges.** GST = (baseShipping + sum of surcharges) × 18%.
3. **Historical accuracy.** Past orders use the rate card / FX rate active at their `createdAt`, not current. For Phase 1A: charge snapshots prevent this from being a runtime concern.

## Notification rules

1. **Send via BullMQ workers, never in request path.** API endpoints enqueue; workers send.
2. **Throttle per recipient per template.** Check `notification_logs` before sending; mark THROTTLED if limit exceeded.
3. **Respect quiet hours for non-urgent.** Defer non-urgent notifications past seller's `quietHoursEnd`.

## Webhook rules (outbound)

1. **Sign every payload with HMAC-SHA256** using endpoint's `secretKey`.
2. **Retry policy in BullMQ:** 5 attempts, exponential backoff (30s, 5m, 30m, 6h).
3. **Auto-disable after N consecutive failures** (configurable via system_settings, default 50).
4. **Idempotency:** unique constraint on `(endpointId, eventType, eventId, attemptNumber)` prevents double-send.

---

# Seed Data (Initial Migration)

The first migration should populate essential reference data:

## system_settings (default values)

```sql
INSERT INTO system_settings (key, category, value_type, value_decimal, display_name, description) VALUES
  ('pricing.gst_rate', 'pricing', 'decimal', 18.00, 'GST Rate (%)', 'GST percentage on shipping services'),
  ('pricing.fx_fallback_inr_to_bdt', 'pricing', 'decimal', 1.35, 'Fallback FX Rate INR→BDT', 'Used when FX fetch fails');

INSERT INTO system_settings (key, category, value_type, value_int, display_name, description) VALUES
  ('ops.call_max_attempts', 'ops', 'int', 3, 'Max Call Attempts', 'Calls before auto-cancel'),
  ('ops.call_retry_interval_hours', 'ops', 'int', 4, 'Call Retry Interval (hours)', 'Hours between no-response retries'),
  ('ops.stock_reservation_ttl_hours', 'ops', 'int', 24, 'Stock Reservation TTL (hours)', 'Auto-release reservations after N hours'),
  ('notifications.sms_throttle_per_recipient_per_hour', 'notifications', 'int', 10, 'SMS Throttle', 'Max SMS per recipient per hour'),
  ('webhooks.auto_disable_after_consecutive_failures', 'webhooks', 'int', 50, 'Webhook Auto-Disable Threshold', 'Disable webhook after N consecutive failures'),
  ('webhooks.max_retry_attempts', 'webhooks', 'int', 5, 'Webhook Max Retries', 'Max webhook delivery retry attempts');
```

## couriers (initial)

```sql
INSERT INTO couriers (code, name, display_name, integration_type, supports_cod, supports_prepaid, supports_rto, default_service_types, volumetric_divisor, priority_for_routing) VALUES
  ('delhivery', 'Delhivery', 'Delhivery Express', 'api_full', TRUE, TRUE, TRUE, ARRAY['express', 'surface'], 5000, 50),
  ('manual', 'Manual Courier', 'Manual Courier Assignment', 'manual', TRUE, TRUE, TRUE, ARRAY['express'], 5000, 999);
```

## fx_rates (initial fallback)

```sql
INSERT INTO fx_rates (id, from_currency, to_currency, rate, source, fetched_at) VALUES
  (uuidv7(), 'INR', 'BDT', 1.35, 'FALLBACK', NOW()),
  (uuidv7(), 'BDT', 'INR', 0.74, 'FALLBACK', NOW());
```

## warehouses (one BLR warehouse)

```sql
INSERT INTO warehouses (id, code, name, status, country_code, timezone) VALUES
  (uuidv7(), 'BLR-01', 'Bangalore Main', 'active', 'IN', 'Asia/Kolkata');
```

## rate_cards (one default)

```sql
INSERT INTO rate_cards (id, code, name, description, is_default, is_active, effective_from, currency) VALUES
  (uuidv7(), 'default-2026', 'Default Rate Card 2026', 'Standard rates for all sellers without custom contracts', TRUE, TRUE, NOW(), 'INR');
```

Rate card items, zone matrix, surcharges — populated by admin via UI later.

## notification_templates (essential set, English)

A minimal seed of templates needed for Phase 1A flows. Codes:
- `order.confirmed.customer.sms`
- `order.confirmed.seller.email`
- `shipment.dispatched.customer.sms`
- `shipment.out_for_delivery.customer.sms`
- `shipment.delivered.customer.sms`
- `shipment.rto_initiated.seller.email`
- `seller.invitation.email`
- `seller.welcome.email`
- `seller.approved.email`
- `seller.rejected.email`
- `staff.password_reset.email`
- `seller.password_reset.email`

Hindi variants for customer-facing SMS added via admin UI later.

## categories (seed taxonomy — optional)

Phase 1A can launch with sellers creating their own categories under a flat list. A pre-seeded global taxonomy (Apparel, Electronics, Beauty, Home, etc.) can be added if helpful.

---

# Open Decisions / Future Work

Items deferred to later phases (do not implement in Phase 1A):

| Item | Phase | Notes |
|---|---|---|
| Seller wallet + ledger | 1B | Foundation in `order_charges` |
| GST-compliant invoicing | 1B | Tax fields already on charges |
| Payment gateway top-up | 1B | Cross-border complexity |
| COD reconciliation | 1B | Manual offline in 1A |
| Cross-border remittance | 1B | Banking + regulatory work |
| Historical FX | 1B | Schema migration when needed |
| Notification template versioning | 2 | Audit logs sufficient now |
| Click-to-call integration | 2 | Manual logging works |
| Call recording storage | 2 | Spaces-ready, not needed |
| PostGIS for route optimization | 2 | Schema-ready, deferred |
| Live driver GPS tracking | 3 | Big project |
| Driver mobile app | 3 | Big project |
| Multi-warehouse support | 2 | Schema-ready |
| Outbound webhook UI (advanced) | 2 | Basic in 1A |
| Customer accounts (auth) | 3 | Currently public tracking only |

---

# Migration & Implementation Plan

When Claude Code implements this schema:

1. **Create `packages/db/` workspace** (Prisma + client + types)
2. **Translate this document to `schema.prisma`** in chunks, layer by layer
3. **Run `prisma generate`** to produce the client
4. **Create initial migration** via `prisma migrate dev --name init`
5. **Append TimescaleDB SQL** to the migration file (manual post-step)
6. **Create `seed.ts`** with the seed data documented above
7. **Verify against local Docker Postgres** by running migration + seed end-to-end
8. **Type-check the generated client** to confirm everything compiles

Reference this document at every step. Do not deviate without explicit approval.

---

*Last updated: 2026-05-14*
*Schema designed in chat across Layers 1–9; this document consolidates that design.*
