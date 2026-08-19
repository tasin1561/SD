-- Two-leg consignments (docs/consignment-two-leg.md).

-- ── new enums ────────────────────────────────────────────────────────
CREATE TYPE "consignment_route" AS ENUM ('direct_in', 'via_bd');
CREATE TYPE "consignment_status" AS ENUM ('pending', 'at_bd', 'in_transit', 'completed', 'cancelled');
CREATE TYPE "consignment_leg" AS ENUM ('bd_intake', 'in_final');
CREATE TYPE "labelling_site" AS ENUM ('none', 'bd', 'in');
CREATE TYPE "consignment_event_type" AS ENUM (
  'declared', 'bd_received', 'labels_printed', 'dispatched_to_in',
  'in_received', 'variance_recorded', 'freight_recorded', 'cancelled'
);

-- Added values are NOT used anywhere in this migration, which is what
-- keeps `ADD VALUE` safe inside Prisma's transaction (a new label cannot
-- be referenced until the adding transaction commits).
ALTER TYPE "stock_movement_reason_code" ADD VALUE IF NOT EXISTS 'in_transit_loss';
ALTER TYPE "stock_movement_reason_code" ADD VALUE IF NOT EXISTS 'in_transit_surplus';
ALTER TYPE "stock_movement_reason_code" ADD VALUE IF NOT EXISTS 'returned_to_seller';
ALTER TYPE "stock_unit_status" ADD VALUE IF NOT EXISTS 'returned_to_seller';

-- ── consignments ─────────────────────────────────────────────────────
CREATE TABLE "consignments" (
  "id"                  UUID NOT NULL DEFAULT uuidv7(),
  "seller_id"           UUID NOT NULL,
  "consignment_number"  TEXT NOT NULL,
  "route"               "consignment_route" NOT NULL,
  "status"              "consignment_status" NOT NULL DEFAULT 'pending',
  "labelling_site"      "labelling_site" NOT NULL DEFAULT 'none',
  "labels_printed_at"   TIMESTAMPTZ,
  "expected_arrival_at" TIMESTAMPTZ,
  "seller_reference"    TEXT,
  "cancelled_at"        TIMESTAMPTZ,
  "cancel_reason"       TEXT,
  "created_at"          TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"          TIMESTAMPTZ NOT NULL,
  "deleted_at"          TIMESTAMPTZ,
  CONSTRAINT "consignments_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "consignments_consignment_number_key" ON "consignments"("consignment_number");
CREATE INDEX "consignments_seller_id_status_idx" ON "consignments"("seller_id", "status");
CREATE INDEX "consignments_status_idx" ON "consignments"("status");
CREATE INDEX "consignments_deleted_at_idx" ON "consignments"("deleted_at");
ALTER TABLE "consignments" ADD CONSTRAINT "consignments_seller_id_fkey"
  FOREIGN KEY ("seller_id") REFERENCES "sellers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "consignment_events" (
  "id"                   UUID NOT NULL DEFAULT uuidv7(),
  "consignment_id"       UUID NOT NULL,
  "type"                 "consignment_event_type" NOT NULL,
  "description"          TEXT,
  "data"                 JSONB,
  "actor_type"           "actor_type",
  "actor_id"             UUID,
  "is_visible_to_seller" BOOLEAN NOT NULL DEFAULT true,
  "created_at"           TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "consignment_events_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "consignment_events_consignment_id_created_at_idx"
  ON "consignment_events"("consignment_id", "created_at");
CREATE INDEX "consignment_events_type_idx" ON "consignment_events"("type");
ALTER TABLE "consignment_events" ADD CONSTRAINT "consignment_events_consignment_id_fkey"
  FOREIGN KEY ("consignment_id") REFERENCES "consignments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ── goods receipts become legs ───────────────────────────────────────
ALTER TABLE "goods_receipts"
  ADD COLUMN "consignment_id"      UUID,
  ADD COLUMN "leg"                 "consignment_leg",
  ADD COLUMN "dispatched_at"       TIMESTAMPTZ,
  ADD COLUMN "dispatched_by_id"    UUID;
CREATE INDEX "goods_receipts_consignment_id_idx" ON "goods_receipts"("consignment_id");
CREATE INDEX "goods_receipts_dispatched_by_id_idx" ON "goods_receipts"("dispatched_by_id");
ALTER TABLE "goods_receipts" ADD CONSTRAINT "goods_receipts_consignment_id_fkey"
  FOREIGN KEY ("consignment_id") REFERENCES "consignments"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "goods_receipts" ADD CONSTRAINT "goods_receipts_dispatched_by_id_fkey"
  FOREIGN KEY ("dispatched_by_id") REFERENCES "staff_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ── the freight bill hangs off the CONSIGNMENT, not one receipt ──────
-- With a BD intake and one or more India arrivals, no single receipt is
-- the thing being billed, and FRT-1's per-unit split must run over the
-- units that ACTUALLY landed. Production holds zero freight charges, so
-- this is a drop-and-add rather than a backfill.
ALTER TABLE "inbound_freight_charges" DROP CONSTRAINT IF EXISTS "inbound_freight_charges_goods_receipt_id_fkey";
DROP INDEX IF EXISTS "inbound_freight_charges_goods_receipt_id_key";
ALTER TABLE "inbound_freight_charges" DROP COLUMN "goods_receipt_id";
ALTER TABLE "inbound_freight_charges" ADD COLUMN "consignment_id" UUID NOT NULL;
CREATE UNIQUE INDEX "inbound_freight_charges_consignment_id_key"
  ON "inbound_freight_charges"("consignment_id");
ALTER TABLE "inbound_freight_charges" ADD CONSTRAINT "inbound_freight_charges_consignment_id_fkey"
  FOREIGN KEY ("consignment_id") REFERENCES "consignments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
