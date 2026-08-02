-- Superseded: its key is a prefix of orders_seller_id_status_placed_at_idx,
-- so from here it can only cost write throughput.
DROP INDEX CONCURRENTLY IF EXISTS "orders_seller_id_status_idx";
