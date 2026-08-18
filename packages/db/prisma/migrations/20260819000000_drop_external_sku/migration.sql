-- Drop external_sku from products and product_variants.
--
-- It was a second identifier alongside our own `sku_code` — the code a
-- seller's other system uses for the same thing — and NOTHING read it.
-- Not the CSV importer's matching (that keys on `sku_code` and
-- `external_ref`), not an order line, not the courier payload, not the
-- invoice. It was two more boxes on the catalogue forms and a row of "—"
-- on every detail page.
--
-- `external_ref` on products SURVIVES and is unaffected: that one is
-- load-bearing, because a CSV re-upload uses it to decide whether a new
-- SKU belongs to a product it already has.
--
-- Production held ZERO non-empty values in both columns when this ran, so
-- the drop destroys no data — the same precondition the brand and HS-code
-- drops were held to.
ALTER TABLE "products" DROP COLUMN IF EXISTS "external_sku";
ALTER TABLE "product_variants" DROP COLUMN IF EXISTS "external_sku";
