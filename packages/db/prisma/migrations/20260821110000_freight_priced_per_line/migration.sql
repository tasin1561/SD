-- Freight is entered as the forwarder's own invoice lines, not as a
-- lump sum split by catalogue weight.
--
-- The old model took one total and apportioned it by recorded SKU
-- weight, with a count fallback for anything unweighed. That was an
-- inference standing in for a document ops already has in front of
-- them — and it disagreed with the invoice whenever the forwarder used
-- volumetric weight, rounded up to the next half kilo, or priced part
-- of the shipment per piece.
--
-- Now each line carries the basis, the rate as invoiced, the chargeable
-- weight when priced by weight, and the resulting line total. The bill
-- total is the sum of its lines.
--
-- Safe as NOT NULL adds: inbound_freight_allocations is empty in every
-- environment (production verified: 0 rows).

CREATE TYPE "inbound_freight_basis" AS ENUM ('per_kg', 'per_piece');

ALTER TABLE "inbound_freight_allocations"
  ADD COLUMN "basis" "inbound_freight_basis" NOT NULL,
  ADD COLUMN "rate_inr" DECIMAL(12,4) NOT NULL,
  ADD COLUMN "chargeable_weight_kg" DECIMAL(12,3),
  ADD COLUMN "line_total_inr" DECIMAL(12,2) NOT NULL;
