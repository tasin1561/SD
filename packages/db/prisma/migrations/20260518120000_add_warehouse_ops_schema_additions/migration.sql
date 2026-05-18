-- CreateEnum
CREATE TYPE "manifest_status" AS ENUM ('draft', 'closed');

-- CreateEnum
CREATE TYPE "rto_item_condition" AS ENUM ('good', 'damaged', 'missing');

-- CreateEnum
CREATE TYPE "rto_disposition" AS ENUM ('restock', 'write_off');

-- AlterEnum
ALTER TYPE "staff_role" ADD VALUE 'warehouse_supervisor';

-- AlterTable
ALTER TABLE "shipment_items" ADD COLUMN     "rto_condition" "rto_item_condition",
ADD COLUMN     "rto_disposed_by_staff_id" UUID,
ADD COLUMN     "rto_disposition" "rto_disposition",
ADD COLUMN     "rto_inspection_notes" TEXT;

-- AlterTable
ALTER TABLE "shipments" ADD COLUMN     "manifest_id" UUID,
ADD COLUMN     "pack_completed_at" TIMESTAMPTZ,
ADD COLUMN     "packed_by_staff_id" UUID,
ADD COLUMN     "pick_completed_at" TIMESTAMPTZ,
ADD COLUMN     "pick_expires_at" TIMESTAMPTZ,
ADD COLUMN     "pick_started_at" TIMESTAMPTZ,
ADD COLUMN     "pick_started_by_staff_id" UUID;

-- CreateTable
CREATE TABLE "manifests" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "manifest_number" TEXT NOT NULL,
    "courier_code" TEXT NOT NULL,
    "origin_warehouse_id" UUID NOT NULL,
    "status" "manifest_status" NOT NULL DEFAULT 'draft',
    "closed_by_staff_id" UUID,
    "closed_at" TIMESTAMPTZ,
    "awb_batch_enqueued_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "manifests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "manifests_manifest_number_key" ON "manifests"("manifest_number");

-- CreateIndex
CREATE INDEX "manifests_courier_code_status_idx" ON "manifests"("courier_code", "status");

-- CreateIndex
CREATE INDEX "manifests_origin_warehouse_id_idx" ON "manifests"("origin_warehouse_id");

-- CreateIndex
CREATE INDEX "manifests_status_created_at_idx" ON "manifests"("status", "created_at");

-- CreateIndex
CREATE INDEX "manifests_closed_by_staff_id_idx" ON "manifests"("closed_by_staff_id");

-- CreateIndex
CREATE INDEX "shipment_items_rto_disposed_by_staff_id_idx" ON "shipment_items"("rto_disposed_by_staff_id");

-- CreateIndex
CREATE INDEX "shipments_status_pick_started_at_created_at_idx" ON "shipments"("status", "pick_started_at", "created_at");

-- CreateIndex
CREATE INDEX "shipments_pick_expires_at_idx" ON "shipments"("pick_expires_at");

-- CreateIndex
CREATE INDEX "shipments_manifest_id_idx" ON "shipments"("manifest_id");

-- CreateIndex
CREATE INDEX "shipments_pick_started_by_staff_id_idx" ON "shipments"("pick_started_by_staff_id");

-- CreateIndex
CREATE INDEX "shipments_packed_by_staff_id_idx" ON "shipments"("packed_by_staff_id");

-- AddForeignKey
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_pick_started_by_staff_id_fkey" FOREIGN KEY ("pick_started_by_staff_id") REFERENCES "staff_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_packed_by_staff_id_fkey" FOREIGN KEY ("packed_by_staff_id") REFERENCES "staff_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_manifest_id_fkey" FOREIGN KEY ("manifest_id") REFERENCES "manifests"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shipment_items" ADD CONSTRAINT "shipment_items_rto_disposed_by_staff_id_fkey" FOREIGN KEY ("rto_disposed_by_staff_id") REFERENCES "staff_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manifests" ADD CONSTRAINT "manifests_courier_code_fkey" FOREIGN KEY ("courier_code") REFERENCES "couriers"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manifests" ADD CONSTRAINT "manifests_origin_warehouse_id_fkey" FOREIGN KEY ("origin_warehouse_id") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manifests" ADD CONSTRAINT "manifests_closed_by_staff_id_fkey" FOREIGN KEY ("closed_by_staff_id") REFERENCES "staff_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

