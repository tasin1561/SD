-- Remove product categories.
--
-- Categories contributed exactly two things to a live order: a fallback
-- for `hsCode` and one for `gstRate`. Both survive without them —
-- hsCode still falls back to the product, and gstRate to the
-- `pricing.gst_rate` system setting, which is where 18% actually comes
-- from today. Nothing else read a category: `default_package_type`,
-- `requires_fragile` and `requires_cold_chain` were written by the
-- category CRUD and never consulted by pricing, packing or dispatch,
-- and `category_courier_rules` had no reader at all.
--
-- Attribute definitions were category-scoped by construction, so they
-- go with it. `product_variants.attributes` stays and becomes
-- free-form. That is strictly more permissive than today: with no
-- category the effective attribute set was empty and the validator
-- rejected EVERY key as unknown, so an uncategorised product could not
-- carry attributes at all.

-- Drop dependents first: each FKs `categories`.
DROP TABLE IF EXISTS "category_attribute_definitions";
DROP TABLE IF EXISTS "category_courier_rules";
DROP TABLE IF EXISTS "category_proposals";

-- The product's own link. Dropping the column drops its FK and index.
ALTER TABLE "products" DROP COLUMN IF EXISTS "category_id";

DROP TABLE IF EXISTS "categories";

DROP TYPE IF EXISTS "category_proposal_status";
DROP TYPE IF EXISTS "attribute_value_type";
