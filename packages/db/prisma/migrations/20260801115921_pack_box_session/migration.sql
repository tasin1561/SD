-- CreateEnum
CREATE TYPE "pack_box_status" AS ENUM ('open', 'closed', 'cancelled', 'expired');

-- DropForeignKey
ALTER TABLE "seller_email_verification_tokens" DROP CONSTRAINT "seller_email_verification_tokens_seller_user_id_fkey";

-- DropForeignKey
ALTER TABLE "seller_password_reset_tokens" DROP CONSTRAINT "seller_password_reset_tokens_seller_user_id_fkey";

-- DropForeignKey
ALTER TABLE "seller_refresh_tokens" DROP CONSTRAINT "seller_refresh_tokens_seller_user_id_fkey";

-- CreateTable
CREATE TABLE "pack_boxes" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "shipment_id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "packer_staff_id" UUID NOT NULL,
    "status" "pack_box_status" NOT NULL DEFAULT 'open',
    "opened_with_code" TEXT NOT NULL,
    "opened_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ NOT NULL,
    "closed_at" TIMESTAMPTZ,
    "cancelled_at" TIMESTAMPTZ,
    "cancel_reason" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "pack_boxes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pack_box_scans" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "pack_box_id" UUID NOT NULL,
    "variant_id" UUID NOT NULL,
    "stock_unit_id" UUID,
    "scanned_code" TEXT NOT NULL,
    "scanned_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pack_box_scans_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "pack_boxes_shipment_id_idx" ON "pack_boxes"("shipment_id");

-- CreateIndex
CREATE INDEX "pack_boxes_packer_staff_id_status_idx" ON "pack_boxes"("packer_staff_id", "status");

-- CreateIndex
CREATE INDEX "pack_boxes_status_expires_at_idx" ON "pack_boxes"("status", "expires_at");

-- CreateIndex
CREATE INDEX "pack_box_scans_pack_box_id_idx" ON "pack_box_scans"("pack_box_id");

-- CreateIndex
CREATE INDEX "pack_box_scans_stock_unit_id_idx" ON "pack_box_scans"("stock_unit_id");

-- AddForeignKey
ALTER TABLE "seller_refresh_tokens" ADD CONSTRAINT "seller_refresh_tokens_seller_user_id_fkey" FOREIGN KEY ("seller_user_id") REFERENCES "seller_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "seller_password_reset_tokens" ADD CONSTRAINT "seller_password_reset_tokens_seller_user_id_fkey" FOREIGN KEY ("seller_user_id") REFERENCES "seller_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "seller_email_verification_tokens" ADD CONSTRAINT "seller_email_verification_tokens_seller_user_id_fkey" FOREIGN KEY ("seller_user_id") REFERENCES "seller_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pack_boxes" ADD CONSTRAINT "pack_boxes_shipment_id_fkey" FOREIGN KEY ("shipment_id") REFERENCES "shipments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pack_boxes" ADD CONSTRAINT "pack_boxes_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pack_boxes" ADD CONSTRAINT "pack_boxes_packer_staff_id_fkey" FOREIGN KEY ("packer_staff_id") REFERENCES "staff_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pack_box_scans" ADD CONSTRAINT "pack_box_scans_pack_box_id_fkey" FOREIGN KEY ("pack_box_id") REFERENCES "pack_boxes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pack_box_scans" ADD CONSTRAINT "pack_box_scans_variant_id_fkey" FOREIGN KEY ("variant_id") REFERENCES "product_variants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pack_box_scans" ADD CONSTRAINT "pack_box_scans_stock_unit_id_fkey" FOREIGN KEY ("stock_unit_id") REFERENCES "stock_units"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- RenameIndex
ALTER INDEX "fx_rate_history_from_to_recorded_at_idx" RENAME TO "fx_rate_history_from_currency_to_currency_recorded_at_idx";

-- ─────────────────────────────────────────────────────────────────────
-- THE LOCK.
--
-- Ten packers work the bench in parallel. Two guarantees make that safe,
-- and both are PARTIAL uniques rather than application checks: a
-- read-then-write guard under READ COMMITTED lets two concurrent callers
-- both read "no open box" and both proceed, which is exactly the failure
-- this is here to prevent.
--
-- Partial, not plain, because a shipment and a packer legitimately have
-- MANY boxes over time — just never two OPEN at once. Only the open ones
-- are constrained; closed, cancelled and expired rows are history.
-- ─────────────────────────────────────────────────────────────────────

-- A parcel is open on at most one bench.
CREATE UNIQUE INDEX "pack_boxes_one_open_per_shipment"
  ON "pack_boxes" ("shipment_id")
  WHERE "status" = 'open';

-- A packer holds at most one open box: they must close or cancel the
-- box in front of them before starting another. This is the "panel is
-- locked until the box is closed" rule, enforced where it cannot be
-- raced.
CREATE UNIQUE INDEX "pack_boxes_one_open_per_packer"
  ON "pack_boxes" ("packer_staff_id")
  WHERE "status" = 'open';
