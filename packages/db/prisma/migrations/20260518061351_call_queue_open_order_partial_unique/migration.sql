-- DropIndex (Module 7: orderId is no longer a hard unique — locked
-- decision #2 requires a NEW queue entry per re-attempt while the
-- prior is COMPLETED).
DROP INDEX "call_queue_entries_order_id_key";

-- Partial unique (migration-managed — Prisma cannot declare a filtered
-- unique). Invariant: at most ONE open (PENDING/ASSIGNED) queue entry
-- per order; COMPLETED/EXPIRED rows accumulate as historical record.
CREATE UNIQUE INDEX "call_queue_entries_open_order_uq"
  ON "call_queue_entries" ("order_id")
  WHERE status IN ('pending','assigned');
