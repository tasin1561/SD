-- Same list with a status filter (the tabs on the orders page).
CREATE INDEX CONCURRENTLY IF NOT EXISTS "orders_seller_id_status_placed_at_idx"
  ON "orders" ("seller_id", "status", "placed_at" DESC);
