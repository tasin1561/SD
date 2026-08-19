-- Two-leg consignments, foundations (docs/consignment-two-leg.md).
--
-- 1. TRANSIT is a real bin type. Goods between two warehouses are in
--    neither building; booking them to either makes that building's
--    cycle count find them missing. The bin lives in the DESTINATION
--    warehouse and is non-pickable, so INV-3 availability and the pick
--    allocator both refuse it (one shared constant, BIN-2).
ALTER TYPE "bin_type" ADD VALUE IF NOT EXISTS 'transit';

-- 2. A warehouse that takes stock in but never ships an order out.
--    Defaults true so every existing warehouse keeps behaving exactly
--    as it does today.
ALTER TABLE "warehouses"
  ADD COLUMN IF NOT EXISTS "fulfils_orders" BOOLEAN NOT NULL DEFAULT true;
