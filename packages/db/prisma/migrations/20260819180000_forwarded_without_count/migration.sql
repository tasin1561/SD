-- A Bangladesh stop that handles a consignment and sends it on WITHOUT
-- opening it.
--
-- Counting in Dhaka is useful but not always worth the hours: a sealed
-- carton that is going straight on to India can be forwarded on the
-- seller's declared quantities, and counted once when it lands.
--
-- This needs its own column because none of the existing states says it.
-- A count of zero is a warehouse that opened the carton and found
-- nothing; a discrepancy is two numbers that disagree. Here nobody
-- looked, so there is no number and no difference — and rendering either
-- would invent a shortfall.
ALTER TABLE "goods_receipts"
  ADD COLUMN IF NOT EXISTS "forwarded_without_count" BOOLEAN NOT NULL DEFAULT false;
