-- Who actually carried a manually-placed parcel.
--
-- `courier_code` is the literal 'manual' for these (CUR-8), so the seller's
-- tracking view and the public tracking page both named the carrier "manual".
-- The name was being written into `service_type`, one column answering two
-- questions — and because it was written as `serviceType ?? courierName`, an
-- operator who supplied a real service type had the carrier name discarded
-- with nothing reporting it.
ALTER TABLE "shipments" ADD COLUMN "manual_courier_name" TEXT;

-- Backfill what is recoverable. For a manually-placed shipment `service_type`
-- holds the carrier name in every case the admin panel produced (it only ever
-- collected a name). `service_type` is left in place rather than cleared: on
-- the rows where it was a genuine service type, clearing it would destroy the
-- one fact this migration cannot tell apart from the other.
UPDATE "shipments"
   SET "manual_courier_name" = "service_type"
 WHERE "is_manual_courier" = true
   AND "service_type" IS NOT NULL
   AND "manual_courier_name" IS NULL;
