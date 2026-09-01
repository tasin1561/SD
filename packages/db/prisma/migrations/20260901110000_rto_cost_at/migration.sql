-- When the RETURN leg's cost was last set.
--
-- The forward leg has had `actual_courier_cost_at` since the column was
-- added; the return leg never got its pair. It matters more than
-- symmetry: a courier charge is not final — Delhivery refunds and
-- re-charges weeks after a parcel moved — so a cost figure without the
-- moment it was written cannot be told apart from a stale one.
ALTER TABLE "shipments" ADD COLUMN "actual_rto_cost_at" TIMESTAMPTZ;
