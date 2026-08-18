-- Drop HS code everywhere.
--
-- The field asked every seller for a customs classification number on
-- every variant, and nothing downstream required one: it was optional in
-- every DTO, optional in the Delhivery payload, and printed as "—" on the
-- invoice whenever it was absent — which was always. Production carried
-- ZERO non-null values across all four columns when this ran, so the drop
-- destroys no data.
--
-- `order_items` and `shipment_items` are ORD-6 snapshots, normally
-- append-only and never rewritten. Dropping a column from them is a
-- schema change rather than a data edit, and it is only safe here
-- BECAUSE the count was zero — no historical invoice loses a value it
-- used to print.
--
-- Note for whoever needs HSN back: an Indian GST invoice is required to
-- carry it above the turnover thresholds, so this returns as an
-- invoice-line concern rather than a per-variant field a seller types.
ALTER TABLE "products" DROP COLUMN IF EXISTS "default_hs_code";
ALTER TABLE "product_variants" DROP COLUMN IF EXISTS "hs_code";
ALTER TABLE "order_items" DROP COLUMN IF EXISTS "hs_code";
ALTER TABLE "shipment_items" DROP COLUMN IF EXISTS "hs_code";
