-- The rest of the courier's tracking envelope.
--
-- The parser read `AWB` and `Scans` and dropped everything else, so
-- these arrived on every poll and were discarded. Each is what the
-- COURIER says, kept alongside what WE say, so the two can be compared.
--
-- courier_collectable_inr is the one that matters most: `cod_amount_inr`
-- is what we told them to collect and this is what they say they will.
-- They should agree, and a disagreement is money — detectable now
-- before it arrives as a remittance that is short.
ALTER TABLE "shipments"
  ADD COLUMN "courier_collectable_inr" DECIMAL(12,2),
  ADD COLUMN "courier_picked_up_at"    TIMESTAMPTZ,
  ADD COLUMN "courier_sort_code"       TEXT,
  -- NOT authoritative: the latest tracking_events row already holds the
  -- current status. These are a convenience mirror so a listing screen
  -- need not join the hypertable per row; anything DECIDING something
  -- reads the scan.
  ADD COLUMN "courier_status_line"     TEXT,
  ADD COLUMN "courier_status_location" TEXT;
