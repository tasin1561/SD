-- Did the seller know?
--
-- A duplicate warning the seller can click through is only useful if the
-- click is recorded. Without this there is no answer the first time a
-- seller disputes being charged two delivery fees for what they say was
-- one order.
ALTER TABLE "orders" ADD COLUMN "duplicate_acknowledged_at" TIMESTAMPTZ;
