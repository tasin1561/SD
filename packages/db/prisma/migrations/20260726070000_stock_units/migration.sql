-- R4 (revised-plan roadmap) — STRICT-mode per-unit inventory.
--
-- Fully additive. `product_variants.inventory_mode` is NULLABLE with no
-- default, so every existing SKU resolves through the seller's
-- `inventory.default_inventory_mode` setting (seeded 'NORMAL') and
-- nothing changes behaviour on deploy. The two new tables start empty:
-- units only appear once a strict-mode SKU is received.

CREATE TYPE "inventory_mode" AS ENUM (
  'normal',
  'strict'
);

CREATE TYPE "stock_unit_status" AS ENUM (
  'in_stock',
  'picked',
  'packed',
  'dispatched',
  'rto_received',
  'written_off',
  'lost'
);

ALTER TABLE "product_variants"
  ADD COLUMN "inventory_mode" "inventory_mode";

-- One row per PHYSICAL UNIT. Sidecar to stock_levels, which stays the
-- authoritative availability number for both modes (INV-3 untouched).
CREATE TABLE "stock_units" (
  "id"                    UUID NOT NULL DEFAULT uuidv7(),
  "seller_id"             UUID NOT NULL,
  "variant_id"            UUID NOT NULL,
  "serial_barcode"        TEXT NOT NULL,
  "status"                "stock_unit_status" NOT NULL DEFAULT 'in_stock',
  "warehouse_id"          UUID NOT NULL,
  "bin_id"                UUID,
  "batch_id"              UUID,
  "goods_receipt_line_id" UUID,
  "shipment_item_id"      UUID,
  "is_system_generated"   BOOLEAN NOT NULL DEFAULT true,
  "last_scan_at"          TIMESTAMPTZ,
  "last_scan_by_staff_id" UUID,
  "write_off_reason"      TEXT,
  "note"                  TEXT,
  "created_at"            TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"            TIMESTAMPTZ NOT NULL,

  CONSTRAINT "stock_units_pkey" PRIMARY KEY ("id")
);

-- Serials are unique PER SELLER, not globally: two sellers can each
-- receive units carrying the same supplier-printed barcode.
CREATE UNIQUE INDEX "stock_units_seller_id_serial_barcode_key"
  ON "stock_units" ("seller_id", "serial_barcode");

CREATE INDEX "stock_units_seller_id_variant_id_status_idx"
  ON "stock_units" ("seller_id", "variant_id", "status");
CREATE INDEX "stock_units_warehouse_id_status_idx"
  ON "stock_units" ("warehouse_id", "status");
CREATE INDEX "stock_units_shipment_item_id_idx"
  ON "stock_units" ("shipment_item_id");
CREATE INDEX "stock_units_batch_id_idx"
  ON "stock_units" ("batch_id");
CREATE INDEX "stock_units_bin_id_idx"
  ON "stock_units" ("bin_id");
CREATE INDEX "stock_units_goods_receipt_line_id_idx"
  ON "stock_units" ("goods_receipt_line_id");
CREATE INDEX "stock_units_last_scan_by_staff_id_idx"
  ON "stock_units" ("last_scan_by_staff_id");
-- Drives the discrepancy report ("stuck in a mid-lifecycle status").
CREATE INDEX "stock_units_status_updated_at_idx"
  ON "stock_units" ("status", "updated_at");

ALTER TABLE "stock_units"
  ADD CONSTRAINT "stock_units_seller_id_fkey"
  FOREIGN KEY ("seller_id") REFERENCES "sellers" ("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "stock_units"
  ADD CONSTRAINT "stock_units_variant_id_fkey"
  FOREIGN KEY ("variant_id") REFERENCES "product_variants" ("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "stock_units"
  ADD CONSTRAINT "stock_units_warehouse_id_fkey"
  FOREIGN KEY ("warehouse_id") REFERENCES "warehouses" ("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "stock_units"
  ADD CONSTRAINT "stock_units_bin_id_fkey"
  FOREIGN KEY ("bin_id") REFERENCES "warehouse_bins" ("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "stock_units"
  ADD CONSTRAINT "stock_units_batch_id_fkey"
  FOREIGN KEY ("batch_id") REFERENCES "stock_batches" ("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "stock_units"
  ADD CONSTRAINT "stock_units_goods_receipt_line_id_fkey"
  FOREIGN KEY ("goods_receipt_line_id") REFERENCES "goods_receipt_lines" ("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "stock_units"
  ADD CONSTRAINT "stock_units_shipment_item_id_fkey"
  FOREIGN KEY ("shipment_item_id") REFERENCES "shipment_items" ("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "stock_units"
  ADD CONSTRAINT "stock_units_last_scan_by_staff_id_fkey"
  FOREIGN KEY ("last_scan_by_staff_id") REFERENCES "staff_users" ("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- APPEND-ONLY scan log. Joins stock_movements / order_events /
-- call_attempts / audit_logs / ticket_events on the never-modify list.
CREATE TABLE "stock_unit_events" (
  "id"            UUID NOT NULL DEFAULT uuidv7(),
  "stock_unit_id" UUID NOT NULL,
  "from_status"   "stock_unit_status",
  "to_status"     "stock_unit_status" NOT NULL,
  "gate"          TEXT NOT NULL,
  "actor_type"    "actor_type" NOT NULL,
  "actor_id"      UUID,
  "shipment_id"   UUID,
  "warehouse_id"  UUID,
  "note"          TEXT,
  "metadata"      JSONB,
  "created_at"    TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "stock_unit_events_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "stock_unit_events_stock_unit_id_created_at_idx"
  ON "stock_unit_events" ("stock_unit_id", "created_at");
CREATE INDEX "stock_unit_events_to_status_idx"
  ON "stock_unit_events" ("to_status");
CREATE INDEX "stock_unit_events_shipment_id_idx"
  ON "stock_unit_events" ("shipment_id");

ALTER TABLE "stock_unit_events"
  ADD CONSTRAINT "stock_unit_events_stock_unit_id_fkey"
  FOREIGN KEY ("stock_unit_id") REFERENCES "stock_units" ("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
