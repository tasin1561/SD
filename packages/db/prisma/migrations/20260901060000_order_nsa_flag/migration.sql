-- NSA — Needs Seller Attention.
--
-- A parcel that went out for delivery and was STILL out for delivery at
-- the evening cutoff. The van did not reach the customer and the courier
-- has not said why, so a human has to ask.
--
-- Columns on `orders` rather than a new OrderStatus, and rather than a
-- side table. Not a status because the parcel is still genuinely out for
-- delivery and `status` has to keep saying so — an NSA status would need
-- its own edge to every terminal, on each of days 1, 2 and 3, and a
-- missing one strands the order (which is exactly what a missing
-- DELIVERY_FAILED -> IN_TRANSIT edge did the same week). Not a side
-- table because every read of this is "show me the flagged orders",
-- which is a filter on the list somebody is already looking at.
ALTER TABLE "orders"
  ADD COLUMN "nsa_raised_at"                TIMESTAMPTZ,
  ADD COLUMN "nsa_day_count"                INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "nsa_cleared_at"               TIMESTAMPTZ,
  ADD COLUMN "nsa_acknowledged_at"          TIMESTAMPTZ,
  ADD COLUMN "nsa_acknowledged_by_staff_id" UUID,
  ADD COLUMN "nsa_note"                     TEXT;

-- The only query anybody runs against these: the open worklist, per
-- seller for their page and across sellers for ours. Partial, because a
-- raised-and-uncleared flag is a tiny slice of the table and always will
-- be — the whole point is that it is rare.
CREATE INDEX "orders_nsa_open_idx"
  ON "orders" ("seller_id", "nsa_day_count" DESC, "nsa_raised_at")
  WHERE "nsa_raised_at" IS NOT NULL AND "nsa_cleared_at" IS NULL;
