-- R3 amortisation — freight is a per-unit LANDED COST, not a lump invoice.
--
-- 100 units of a SKU arrive on one freight bill. When 1 unit is delivered,
-- the seller pays THAT unit's share; the other 99 stay due until they
-- move. The split is by weight (freight is priced by weight), falling back
-- to unit count for lines whose SKU has no recorded weight.
--
-- Additive: existing bills get totalUnits/unitsSettled 0 and
-- amountSettledInr 0, i.e. "not amortised", and PAY_NOW bills are never
-- amortised at all (they were settled in full at record time).

-- Plain ADD VALUE (no BEFORE/AFTER): repositioning an enum value is not
-- transaction-safe, and sort order of this enum is never relied on.
ALTER TYPE "inbound_freight_status" ADD VALUE 'partially_settled';

ALTER TABLE "inbound_freight_charges"
  ADD COLUMN "total_units"        INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "units_settled"      INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "amount_settled_inr" DECIMAL(12,2) NOT NULL DEFAULT 0;

-- One row per consignment LINE: that line's share of the bill, divided
-- down to a per-unit rate and SNAPSHOTTED (never recomputed, so a later
-- catalog weight edit cannot retro-price goods that already landed).
CREATE TABLE "inbound_freight_allocations" (
  "id"                    UUID NOT NULL DEFAULT uuidv7(),
  "freight_charge_id"     UUID NOT NULL,
  "goods_receipt_line_id" UUID NOT NULL,
  "variant_id"            UUID NOT NULL,
  "units"                 INTEGER NOT NULL,
  "unit_weight_grams"     INTEGER,
  -- 4dp: a bill split across many units needs more precision than the 2dp
  -- money columns or the rounding drift becomes visible.
  "per_unit_inr"          DECIMAL(12,4) NOT NULL,
  "units_settled"         INTEGER NOT NULL DEFAULT 0,
  "amount_settled_inr"    DECIMAL(12,2) NOT NULL DEFAULT 0,
  "created_at"            TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"            TIMESTAMPTZ NOT NULL,

  CONSTRAINT "inbound_freight_allocations_pkey" PRIMARY KEY ("id")
);

-- One allocation per consignment line — also what makes re-recording a
-- freight bill idempotent.
CREATE UNIQUE INDEX "inbound_freight_allocations_goods_receipt_line_id_key"
  ON "inbound_freight_allocations" ("goods_receipt_line_id");
CREATE INDEX "inbound_freight_allocations_freight_charge_id_idx"
  ON "inbound_freight_allocations" ("freight_charge_id");
CREATE INDEX "inbound_freight_allocations_variant_id_idx"
  ON "inbound_freight_allocations" ("variant_id");

ALTER TABLE "inbound_freight_allocations"
  ADD CONSTRAINT "inbound_freight_allocations_freight_charge_id_fkey"
  FOREIGN KEY ("freight_charge_id") REFERENCES "inbound_freight_charges" ("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "inbound_freight_allocations"
  ADD CONSTRAINT "inbound_freight_allocations_goods_receipt_line_id_fkey"
  FOREIGN KEY ("goods_receipt_line_id") REFERENCES "goods_receipt_lines" ("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "inbound_freight_allocations"
  ADD CONSTRAINT "inbound_freight_allocations_variant_id_fkey"
  FOREIGN KEY ("variant_id") REFERENCES "product_variants" ("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
