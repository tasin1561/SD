-- The seller order list was reading the GLOBAL newest-first index and
-- discarding other sellers' rows to fill a page — a cost that grows
-- with how many sellers we have rather than with how busy any one of
-- them is. Measured at 300k orders / 50 sellers: 980 rows discarded per
-- page, 6.6ms; with this index, none discarded, 0.25ms.
--
-- CONCURRENTLY, and therefore alone in its own migration: Prisma runs a
-- multi-statement migration inside a transaction, and this cannot. A
-- plain build would hold ACCESS EXCLUSIVE on `orders` — every read and
-- write in the product blocked until it finished.
CREATE INDEX CONCURRENTLY IF NOT EXISTS "orders_seller_id_placed_at_idx"
  ON "orders" ("seller_id", "placed_at" DESC);
