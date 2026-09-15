-- LBL-5b (2026-09-15): reprinting a STRICT serial label takes two people.
--
-- A serial names ONE physical unit, so a second sticker is how two boxes
-- come to claim the same one. The damaged-label reprint used to be one
-- person with `warehouse.labels.reprint`; it is now a request (anyone who
-- labels goods names the units and says why), an approval by somebody
-- else holding that permission, and one print by the person who asked.
-- An approval lapses 24 hours after it is given; that is derived from
-- `decided_at`, never stored. No data is written here.

-- CreateEnum
CREATE TYPE "label_reprint_request_status" AS ENUM ('pending', 'approved', 'rejected', 'printed');

-- CreateTable
CREATE TABLE "label_reprint_requests" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "consignment_id" UUID NOT NULL,
    "seller_id" UUID NOT NULL,
    "serials" TEXT[],
    "reason" TEXT NOT NULL,
    "status" "label_reprint_request_status" NOT NULL DEFAULT 'pending',
    "requested_by_staff_id" UUID NOT NULL,
    "decided_by_staff_id" UUID,
    "decided_at" TIMESTAMPTZ,
    "decision_note" TEXT,
    "printed_by_staff_id" UUID,
    "printed_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "label_reprint_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "label_reprint_requests_consignment_id_status_idx" ON "label_reprint_requests"("consignment_id", "status");

-- CreateIndex
CREATE INDEX "label_reprint_requests_status_created_at_idx" ON "label_reprint_requests"("status", "created_at");

-- AddForeignKey
ALTER TABLE "label_reprint_requests" ADD CONSTRAINT "label_reprint_requests_consignment_id_fkey" FOREIGN KEY ("consignment_id") REFERENCES "consignments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "label_reprint_requests" ADD CONSTRAINT "label_reprint_requests_seller_id_fkey" FOREIGN KEY ("seller_id") REFERENCES "sellers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "label_reprint_requests" ADD CONSTRAINT "label_reprint_requests_requested_by_staff_id_fkey" FOREIGN KEY ("requested_by_staff_id") REFERENCES "staff_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "label_reprint_requests" ADD CONSTRAINT "label_reprint_requests_decided_by_staff_id_fkey" FOREIGN KEY ("decided_by_staff_id") REFERENCES "staff_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "label_reprint_requests" ADD CONSTRAINT "label_reprint_requests_printed_by_staff_id_fkey" FOREIGN KEY ("printed_by_staff_id") REFERENCES "staff_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
