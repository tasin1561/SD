-- Print-first picking.
--
-- A batch is the unit of work on the floor: one sheet listing every
-- variant to fetch, consolidated across the orders on it, with a shelf
-- location per line. Confirming the print ALLOCATES the stock, which is
-- what makes those locations real rather than a guess.

CREATE TYPE "pick_batch_status" AS ENUM ('draft', 'printed', 'completed', 'cancelled');

CREATE TABLE "pick_batches" (
  "id"                  UUID NOT NULL DEFAULT uuidv7(),
  "batch_number"        TEXT NOT NULL,
  "warehouse_id"        UUID NOT NULL,
  "status"              "pick_batch_status" NOT NULL DEFAULT 'draft',
  "printed_at"          TIMESTAMPTZ,
  "printed_by_staff_id" UUID,
  "created_by_staff_id" UUID,
  "notes"               TEXT,
  "created_at"          TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"          TIMESTAMPTZ NOT NULL,
  CONSTRAINT "pick_batches_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "pick_batches_batch_number_key" ON "pick_batches"("batch_number");
CREATE INDEX "pick_batches_status_created_at_idx" ON "pick_batches"("status", "created_at");
CREATE INDEX "pick_batches_warehouse_id_idx" ON "pick_batches"("warehouse_id");
CREATE INDEX "pick_batches_created_by_staff_id_idx" ON "pick_batches"("created_by_staff_id");
CREATE INDEX "pick_batches_printed_by_staff_id_idx" ON "pick_batches"("printed_by_staff_id");

-- The label print is its OWN fact, separate from awb_generated_at: a
-- waybill can exist for days before anybody puts it on paper, and it is
-- the paper that decides whether a parcel can be picked.
ALTER TABLE "shipments"
  ADD COLUMN "label_printed_at" TIMESTAMPTZ,
  ADD COLUMN "label_printed_by_staff_id" UUID,
  ADD COLUMN "pick_batch_id" UUID;

CREATE INDEX "shipments_pick_batch_id_idx" ON "shipments"("pick_batch_id");
CREATE INDEX "shipments_label_printed_at_idx" ON "shipments"("label_printed_at");

-- Named + actioned explicitly: an inline REFERENCES gets a
-- Postgres-generated name and `prisma migrate diff` compares both.
ALTER TABLE "pick_batches"
  ADD CONSTRAINT "pick_batches_warehouse_id_fkey"
  FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "pick_batches"
  ADD CONSTRAINT "pick_batches_printed_by_staff_id_fkey"
  FOREIGN KEY ("printed_by_staff_id") REFERENCES "staff_users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "pick_batches"
  ADD CONSTRAINT "pick_batches_created_by_staff_id_fkey"
  FOREIGN KEY ("created_by_staff_id") REFERENCES "staff_users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "shipments"
  ADD CONSTRAINT "shipments_label_printed_by_staff_id_fkey"
  FOREIGN KEY ("label_printed_by_staff_id") REFERENCES "staff_users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "shipments"
  ADD CONSTRAINT "shipments_pick_batch_id_fkey"
  FOREIGN KEY ("pick_batch_id") REFERENCES "pick_batches"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
