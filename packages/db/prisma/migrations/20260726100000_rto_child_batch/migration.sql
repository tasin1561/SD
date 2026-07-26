-- R6b (revised-plan roadmap) — cross-warehouse RTO restock lineage.
--
-- A return that lands at a warehouse other than the one it shipped from
-- can now be restocked THERE, into a child batch derived from the
-- original. `parent_batch_id` is what makes that traceable: expiry, unit
-- cost and the receipt→freight-bill chain all come from the parent, and
-- the link records where the goods really came from.
--
-- Additive and NULL for every existing batch.
ALTER TABLE "stock_batches"
  ADD COLUMN "parent_batch_id" UUID;

CREATE INDEX "stock_batches_parent_batch_id_idx"
  ON "stock_batches" ("parent_batch_id");

ALTER TABLE "stock_batches"
  ADD CONSTRAINT "stock_batches_parent_batch_id_fkey"
  FOREIGN KEY ("parent_batch_id") REFERENCES "stock_batches" ("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
