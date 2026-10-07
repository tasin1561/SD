-- The daily digest reads "orders that reached DELIVERED, an RTO status
-- or DELIVERY_FAILED between two instants". That is a status filter and
-- a time window; `order_events_to_status_idx` serves only the first, so
-- the planner would read every event ever recorded for those statuses
-- and discard all but one day of them. order_events only grows.
--
-- CONCURRENTLY so it does not hold a write lock on a table every order
-- state change writes to. It cannot run inside a transaction, which is
-- why this migration contains nothing else.
CREATE INDEX CONCURRENTLY IF NOT EXISTS "order_events_to_status_created_at_idx"
  ON "order_events" ("to_status", "created_at");
