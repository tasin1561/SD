-- The three figures a seller's collectable amount is built from.
--
--   collectable = items total + delivery fee − advance − discount
--
-- Stored rather than computed away. A collectable with no breakdown is a
-- number nobody can check against what the customer was actually told,
-- and the call centre reads that number out loud on every COD order.
--
-- Deliberately NOT folded into `declared_value_inr`, which is the CUSTOMS
-- figure: it goes to Delhivery as total_amount and triggers the e-waybill
-- above 50,000, so a discounted collectable landing there would quietly
-- change whether a legal document is required.
ALTER TABLE "orders"
  ADD COLUMN IF NOT EXISTS "advance_amount_inr" DECIMAL(12,2),
  ADD COLUMN IF NOT EXISTS "delivery_fee_inr"   DECIMAL(12,2),
  ADD COLUMN IF NOT EXISTS "discount_inr"       DECIMAL(12,2);
