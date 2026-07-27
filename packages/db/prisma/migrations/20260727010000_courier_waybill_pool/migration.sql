-- D3 — pre-fetched AWB pool.
--
-- Delhivery's bulk waybill endpoint allows FIVE requests per five minutes,
-- and their docs warn a waybill used immediately after fetching may error
-- (numbers are minted in batches of 25 behind the scenes). Fetching one
-- per shipment at manifest time would be both rate-limited and flaky, so
-- we pull in bulk, let them settle, and hand them out locally.

CREATE TYPE "courier_waybill_status" AS ENUM (
  'available',
  'assigned',
  'used',
  'void'
);

CREATE TABLE "courier_waybills" (
  "id"           UUID NOT NULL DEFAULT uuidv7(),
  "courier_code" TEXT NOT NULL,
  "awb_number"   TEXT NOT NULL,
  "status"       "courier_waybill_status" NOT NULL DEFAULT 'available',
  "fetched_at"   TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "usable_after" TIMESTAMPTZ NOT NULL,
  "assigned_at"  TIMESTAMPTZ,
  "shipment_id"  UUID,
  "voided_at"    TIMESTAMPTZ,
  "void_reason"  TEXT,
  "created_at"   TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"   TIMESTAMPTZ NOT NULL,

  CONSTRAINT "courier_waybills_pkey" PRIMARY KEY ("id")
);

-- Globally unique: the same AWB handed to two shipments would put two
-- parcels on one tracking identity.
CREATE UNIQUE INDEX "courier_waybills_awb_number_key"
  ON "courier_waybills" ("awb_number");

-- The claim query's index: (courier, status, usable_after) ordered.
CREATE INDEX "courier_waybills_courier_code_status_usable_after_idx"
  ON "courier_waybills" ("courier_code", "status", "usable_after");
CREATE INDEX "courier_waybills_shipment_id_idx"
  ON "courier_waybills" ("shipment_id");
