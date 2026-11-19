-- ORD-9 amended 2026-11-19 (owner): an order reference may repeat.
-- Drop the unique key and keep lookups by (seller, store, reference) fast
-- with a plain index. No data changes.
DROP INDEX IF EXISTS "orders_seller_id_store_id_seller_order_ref_key";
CREATE INDEX "orders_seller_id_store_id_seller_order_ref_idx"
  ON "orders"("seller_id", "store_id", "seller_order_ref");
