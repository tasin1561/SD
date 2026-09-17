-- CreateEnum
CREATE TYPE "store_order_request_kind" AS ENUM ('cancel', 'call_cap_decision', 'raise_issue');

-- CreateEnum
CREATE TYPE "store_order_request_status" AS ENUM ('pending', 'approved', 'rejected', 'executed', 'failed', 'expired');

-- CreateEnum
CREATE TYPE "store_call_cap_proposal" AS ENUM ('release', 'request_more_attempts');

-- AlterEnum
ALTER TYPE "delivery_action_status" ADD VALUE 'expired';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "store_address_change_status" ADD VALUE 'expired';
ALTER TYPE "store_address_change_status" ADD VALUE 'superseded';

-- AlterTable
ALTER TABLE "order_delivery_action_requests" ADD COLUMN     "expired_at" TIMESTAMPTZ,
ADD COLUMN     "seller_reminded_at" TIMESTAMPTZ;

-- AlterTable
ALTER TABLE "store_address_change_requests" ADD COLUMN     "expired_at" TIMESTAMPTZ,
ADD COLUMN     "seller_reminded_at" TIMESTAMPTZ;

-- CreateTable
CREATE TABLE "store_order_requests" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "order_id" UUID NOT NULL,
    "seller_id" UUID NOT NULL,
    "store_id" UUID NOT NULL,
    "requested_by_store_user_id" UUID,
    "kind" "store_order_request_kind" NOT NULL,
    "status" "store_order_request_status" NOT NULL DEFAULT 'pending',
    "note" TEXT,
    "cancellation_reason" "order_cancellation_reason",
    "call_cap_proposal" "store_call_cap_proposal",
    "issue_subject" TEXT,
    "decided_by_seller_user_id" UUID,
    "seller_decided_at" TIMESTAMPTZ,
    "decision_note" TEXT,
    "executed_at" TIMESTAMPTZ,
    "execution_ref" TEXT,
    "failure_reason" TEXT,
    "seller_reminded_at" TIMESTAMPTZ,
    "expired_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "store_order_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "store_order_requests_seller_id_status_idx" ON "store_order_requests"("seller_id", "status");

-- CreateIndex
CREATE INDEX "store_order_requests_store_id_status_idx" ON "store_order_requests"("store_id", "status");

-- CreateIndex
CREATE INDEX "store_order_requests_order_id_kind_idx" ON "store_order_requests"("order_id", "kind");

-- CreateIndex
CREATE INDEX "store_order_requests_status_created_at_idx" ON "store_order_requests"("status", "created_at");

-- AddForeignKey
ALTER TABLE "store_order_requests" ADD CONSTRAINT "store_order_requests_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "store_order_requests" ADD CONSTRAINT "store_order_requests_seller_id_fkey" FOREIGN KEY ("seller_id") REFERENCES "sellers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "store_order_requests" ADD CONSTRAINT "store_order_requests_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "seller_stores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ── Data: the two sweep settings (seed.ts is create-only on a deployed DB) ──
INSERT INTO "system_settings" (
  "id", "key", "category", "value_type", "value_int",
  "display_name", "description",
  "is_editable_by_admin", "is_sensitive", "seller_overridable",
  "override_min_int", "override_max_int",
  "created_at", "updated_at"
)
VALUES
  (uuidv7(), 'reseller.store_request_remind_hours', 'reseller', 'int', 24,
   'Reseller store requests: remind seller staff after (hours)',
   'A request a reseller store sent to seller staff for approval (cancel, address correction, delivery action, call-cap answer, issue with Skydrop) that is still unanswered after this many hours reminds seller staff once, in-app.',
   true, false, false, NULL, NULL, now(), now()),
  (uuidv7(), 'reseller.store_request_expire_hours', 'reseller', 'int', 72,
   'Reseller store requests: close unanswered after (hours)',
   'A request still unanswered after this many hours is closed as expired, nothing is carried out, and the reseller store is emailed so it knows to follow up with the seller.',
   true, false, false, NULL, NULL, now(), now())
ON CONFLICT ("key") DO NOTHING;
