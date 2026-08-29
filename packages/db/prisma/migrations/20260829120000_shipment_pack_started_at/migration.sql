-- shipments.pack_started_at — when packing FIRST began on this parcel.
--
-- A projection of `pack_boxes.opened_at`, not a second fact. pack_boxes
-- stays authoritative: it is per box and per packer, which one column
-- can never be. This exists so the pack queue and the floor reports can
-- answer "is anyone on this parcel?" without joining every box, the same
-- way pick_started_at already does for picking.
--
-- PACK-3: PackBoxService is the only writer and sets it in the SAME
-- transaction as the box row, so the two cannot diverge on a crash.
ALTER TABLE "shipments" ADD COLUMN "pack_started_at" TIMESTAMPTZ;

-- BACKFILL from the boxes that already exist, so the column is not
-- silently wrong for every parcel packed before today. The earliest box
-- is the answer; a cancelled-then-reopened parcel correctly reports when
-- work actually started rather than when it restarted.
UPDATE "shipments" s
SET "pack_started_at" = b."first_open"
FROM (
  SELECT "shipment_id", MIN("opened_at") AS "first_open"
  FROM "pack_boxes"
  WHERE "cancelled_at" IS NULL
  GROUP BY "shipment_id"
) b
WHERE b."shipment_id" = s."id";
