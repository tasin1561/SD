-- WMS-8d (2026-09-13): inspect a returned line BY QUANTITY.
--
-- A line of qty 2 can come back one good and one damaged, and until now
-- condition + disposition lived once per shipment_items row, so both
-- units got one choice. Each row here carries its own quantity; a line's
-- rows sum to its quantity (enforced by RtoInspectionService). The
-- shipment_items.rto_* columns stay as a SUMMARY of the rows for the
-- readers that only ask "is this line decided".

-- CreateTable
CREATE TABLE "shipment_item_rto_inspections" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "shipment_item_id" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "quantity" INTEGER NOT NULL,
    "condition" "rto_item_condition" NOT NULL,
    "disposition" "rto_disposition" NOT NULL,
    "notes" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "shipment_item_rto_inspections_pkey" PRIMARY KEY ("id")
);
-- No CHECK (quantity > 0): Prisma cannot describe one and no migration
-- here carries one, so it would be a drift risk against the CI diff gate.
-- The DTO (@Min(1)) and RtoInspectionService refuse a non-positive row.

-- CreateIndex
CREATE UNIQUE INDEX "shipment_item_rto_inspections_shipment_item_id_position_key" ON "shipment_item_rto_inspections"("shipment_item_id", "position");

-- AddForeignKey
ALTER TABLE "shipment_item_rto_inspections" ADD CONSTRAINT "shipment_item_rto_inspections_shipment_item_id_fkey" FOREIGN KEY ("shipment_item_id") REFERENCES "shipment_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill: every line already inspected becomes ONE row covering its
-- whole quantity, carrying exactly what it said before — nothing
-- inspected is lost, and an unsplit line behaves exactly as it did.
-- Lines never inspected get no row (finalize still refuses them).
INSERT INTO "shipment_item_rto_inspections"
    ("shipment_item_id", "position", "quantity", "condition", "disposition", "notes")
SELECT "id", 1, "quantity", "rto_condition", "rto_disposition", "rto_inspection_notes"
FROM "shipment_items"
WHERE "rto_condition" IS NOT NULL
  AND "rto_disposition" IS NOT NULL
  AND "quantity" > 0;
