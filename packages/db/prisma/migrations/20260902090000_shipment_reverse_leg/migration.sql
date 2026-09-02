-- The return leg of a parcel the customer sent back.
--
-- Kept on the SAME shipment rather than a second one: the item
-- snapshot, the RTO inspection and the disposition all key off this
-- row, and forking would split one parcel's story in two and leave the
-- warehouse receiving whichever half somebody guessed.
--
-- It needs its own waybill because Delhivery books a reverse as a new
-- shipment (payment_mode 'Pickup'), and because CUR-9 makes awb_number
-- the once-only gate for the FORWARD leg.
--
-- requested_at is claimed BEFORE the courier is called and stays set on
-- failure: we cannot tell "they never got it" from "the reply was
-- lost", and the cost of guessing wrong is a second van.
ALTER TABLE "shipments"
  ADD COLUMN "reverse_awb_requested_at"    TIMESTAMPTZ,
  ADD COLUMN "reverse_awb_number"          TEXT,
  ADD COLUMN "reverse_awb_generated_at"    TIMESTAMPTZ,
  ADD COLUMN "reverse_courier_shipment_id" TEXT,
  ADD COLUMN "reverse_awb_error"           TEXT;

-- The tracking poll looks parcels up BY WAYBILL, and a reverse waybill
-- has to resolve as fast as a forward one.
CREATE INDEX IF NOT EXISTS "shipments_reverse_awb_number_idx"
  ON "shipments" ("reverse_awb_number");
