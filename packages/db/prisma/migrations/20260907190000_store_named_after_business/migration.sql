-- A seller's first shopfront takes their own business name.
--
-- The stores migration a few hours ago called every one of them
-- "Default store" — a placeholder, and it reads to a seller like a
-- setting they forgot to fill in. Nearly every seller has exactly one
-- shopfront, so the name they see on their orders and in the selector
-- should be one they recognise.
--
-- Only the ones still holding the placeholder are touched. A seller who
-- has already renamed theirs in the hours since has made a decision,
-- and a data migration must not overrule it.
UPDATE "seller_stores" st
SET "name" = LEFT(TRIM(s."company_name"), 80)
FROM "sellers" s
WHERE s."id" = st."seller_id"
  AND st."name" = 'Default store'
  AND st."is_default"
  AND TRIM(s."company_name") <> ''
  -- Two sellers can share a company name, but a store name is unique
  -- only WITHIN a seller, so this cannot collide. A seller who already
  -- has a store called exactly their business name would, though.
  AND NOT EXISTS (
    SELECT 1 FROM "seller_stores" x
    WHERE x."seller_id" = st."seller_id"
      AND x."id" <> st."id"
      AND x."name" = LEFT(TRIM(s."company_name"), 80)
  );

-- And the ORDERS that carry the placeholder as their snapshot.
--
-- ORD-6 says a snapshot is what the customer was told, and renaming a
-- store must never rewrite it. This is the one exception, stated rather
-- than assumed: "Default store" was never shown to anybody. It was
-- written by a backfill hours ago, has appeared on no invoice and in no
-- email, and correcting a placeholder is not the same act as rewriting
-- history. Scoped to that exact string for precisely that reason — a
-- snapshot a seller chose is left alone.
UPDATE "orders" o
SET "store_name_snapshot" = st."name"
FROM "seller_stores" st
WHERE st."id" = o."store_id"
  AND o."store_name_snapshot" = 'Default store';
