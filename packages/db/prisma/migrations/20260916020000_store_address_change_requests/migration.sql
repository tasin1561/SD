-- A reseller store's address correction, held while seller staff decide
-- (2026-09-16, owner: "make the option to enable and disable this from
-- seller for reseller store. also they can select ask them or direct").
--
-- `reseller_store_action_policy.address_fix` already offers three answers.
-- OFF and DIRECT need no table: OFF refuses at the endpoint, and DIRECT
-- writes the correction onto the order there and then, through the same
-- `OrderService.edit` path a store edit has always taken. ASK_SELLER is
-- the one that needs somewhere to WAIT, and this is it.
--
-- Why a table of its own rather than a column on the order: the order
-- must keep the address the courier was given until seller staff say
-- otherwise. Parking a pending correction on the order itself would mean
-- every reader of the recipient block has to know which of the two is
-- live, and the first reader that forgets prints an address nobody
-- approved onto a label. The proposal sits apart until it is applied.
--
-- One column per field of STORE_EDITABLE_KEYS, all nullable: a store
-- correcting a misheard house number sends that field alone, and a NULL
-- here means "not part of this correction", never "clear it".

-- CreateEnum
CREATE TYPE "store_address_change_status" AS ENUM ('pending', 'approved', 'rejected', 'applied', 'failed');

-- CreateTable
CREATE TABLE "store_address_change_requests" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "order_id" UUID NOT NULL,
    "seller_id" UUID NOT NULL,
    "store_id" UUID NOT NULL,
    "requested_by_store_user_id" UUID,
    "reason" TEXT NOT NULL,
    "recipient_name" TEXT,
    "recipient_phone_e164" TEXT,
    "recipient_alt_phone_e164" TEXT,
    "recipient_email" TEXT,
    "recipient_address_line1" TEXT,
    "recipient_address_line2" TEXT,
    "recipient_landmark" TEXT,
    "recipient_city" TEXT,
    "recipient_state_province" TEXT,
    "recipient_postal_code" TEXT,
    "status" "store_address_change_status" NOT NULL DEFAULT 'pending',
    "decided_by_seller_user_id" UUID,
    "seller_decided_at" TIMESTAMPTZ,
    "decision_note" TEXT,
    "applied_at" TIMESTAMPTZ,
    "failure_reason" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "store_address_change_requests_pkey" PRIMARY KEY ("id")
);

-- The seller's queue reads (seller, status) — "what is waiting on me"
-- across every one of their stores, which is the page this exists for.
-- CreateIndex
CREATE INDEX "store_address_change_requests_seller_id_status_idx" ON "store_address_change_requests"("seller_id", "status");

-- The order page reads by order: "is there a correction pending on this
-- parcel", asked by both the store's own view and seller staff's.
-- CreateIndex
CREATE INDEX "store_address_change_requests_order_id_idx" ON "store_address_change_requests"("order_id");

-- RESTRICT on all three, like the delivery-action queue beside it: a
-- decided correction is the evidence for why an address changed, and it
-- must outlive nothing short of the order itself.
-- AddForeignKey
ALTER TABLE "store_address_change_requests" ADD CONSTRAINT "store_address_change_requests_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "store_address_change_requests" ADD CONSTRAINT "store_address_change_requests_seller_id_fkey" FOREIGN KEY ("seller_id") REFERENCES "sellers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "store_address_change_requests" ADD CONSTRAINT "store_address_change_requests_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "seller_stores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
