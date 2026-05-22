-- CreateEnum
CREATE TYPE "supersede_reason" AS ENUM ('awb_rejected', 'non_serviceable', 'courier_failure', 'manual_replacement');

-- AlterEnum
ALTER TYPE "manifest_status" ADD VALUE 'confirmed';
ALTER TYPE "manifest_status" ADD VALUE 'dispatched';
ALTER TYPE "manifest_status" ADD VALUE 'failed';

-- AlterTable
ALTER TABLE "shipments" ADD COLUMN     "superseded_at" TIMESTAMPTZ,
ADD COLUMN     "supersede_reason" "supersede_reason";

-- AlterTable: rename M8's unused awb_batch_enqueued_at → awb_job_enqueued_at
-- (M8 close() emitted a stub audit only; the column was never written —
--  safe rename, no data).
ALTER TABLE "manifests" RENAME COLUMN "awb_batch_enqueued_at" TO "awb_job_enqueued_at";

-- AlterTable
ALTER TABLE "manifests" ADD COLUMN     "awb_job_completed_at" TIMESTAMPTZ,
ADD COLUMN     "handoff_confirmed_at" TIMESTAMPTZ,
ADD COLUMN     "handoff_confirmed_by_staff_id" UUID;

-- CreateIndex
CREATE INDEX "manifests_handoff_confirmed_by_staff_id_idx" ON "manifests"("handoff_confirmed_by_staff_id");

-- AddForeignKey
ALTER TABLE "manifests" ADD CONSTRAINT "manifests_handoff_confirmed_by_staff_id_fkey" FOREIGN KEY ("handoff_confirmed_by_staff_id") REFERENCES "staff_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
