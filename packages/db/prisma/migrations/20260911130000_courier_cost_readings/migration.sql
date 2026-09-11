-- What a courier says each parcel cost, kept every time it changes.
--
-- Shiprocket's statement API returns no transactions (measured
-- 2026-09-11), so there is no ledger to net as COST-1 does for Delhivery.
-- Each order's charge breakdown and, once billing is final, its
-- billing_amount are readable instead — a figure, not a history. These
-- rows are the history: a weight dispute that moves a charge leaves its
-- before and after both on record. Append-only; RESTRICT on both keys.

-- CreateTable
CREATE TABLE "courier_cost_readings" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "courier_account_id" UUID NOT NULL,
    "shipment_id" UUID NOT NULL,
    "courier_code" TEXT NOT NULL,
    "courier_order_id" TEXT NOT NULL,
    "awb_number" TEXT,
    "their_status" TEXT NOT NULL,
    "billed_inr" DECIMAL(12,2),
    "provisional_inr" DECIMAL(12,2),
    "forward_inr" DECIMAL(12,2),
    "cod_charge_inr" DECIMAL(12,2),
    "rto_inr" DECIMAL(12,2),
    "applied_weight_kg" DECIMAL(10,3),
    "charged_weight_kg" DECIMAL(10,3),
    "returned" BOOLEAN NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "read_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "courier_cost_readings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "courier_cost_readings_shipment_id_read_at_idx" ON "courier_cost_readings"("shipment_id", "read_at");

-- CreateIndex
CREATE INDEX "courier_cost_readings_courier_account_id_read_at_idx" ON "courier_cost_readings"("courier_account_id", "read_at");

-- AddForeignKey
ALTER TABLE "courier_cost_readings" ADD CONSTRAINT "courier_cost_readings_courier_account_id_fkey" FOREIGN KEY ("courier_account_id") REFERENCES "courier_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "courier_cost_readings" ADD CONSTRAINT "courier_cost_readings_shipment_id_fkey" FOREIGN KEY ("shipment_id") REFERENCES "shipments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
