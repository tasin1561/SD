-- What things actually cost us.
--
-- Both columns are what the P&L needs and neither existed. Margin was
-- previously measurable only against numbers somebody typed in
-- (`rate_card_items.cost_to_skydrop_inr`) or against nothing at all
-- (the BD→India leg), which makes "profit" a hope rather than a
-- measurement.
--
-- Both nullable, deliberately. A parcel we have not yet priced is
-- honestly unknown; defaulting it to zero would report the whole of its
-- revenue as profit, and defaulting it to the estimate would hide how
-- much of the report is guesswork. The P&L states its coverage instead.
ALTER TABLE "shipments"
  ADD COLUMN "actual_courier_cost_inr" DECIMAL(12,2),
  ADD COLUMN "actual_courier_cost_at"  TIMESTAMPTZ;

ALTER TABLE "inbound_freight_charges"
  ADD COLUMN "our_cost_inr" DECIMAL(12,2);
