-- AlterTable
ALTER TABLE "product_variants" ADD COLUMN     "low_stock_threshold" INTEGER;

-- AlterTable
ALTER TABLE "sellers" ADD COLUMN     "default_low_stock_threshold" INTEGER,
ADD COLUMN     "reservation_ttl_hours_override" INTEGER;

-- CreateTable
CREATE TABLE "stock_alert_state" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "seller_id" UUID NOT NULL,
    "variant_id" UUID NOT NULL,
    "warehouse_id" UUID NOT NULL,
    "was_alert_active" BOOLEAN NOT NULL DEFAULT false,
    "low_stock_alert_sent_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "stock_alert_state_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "stock_alert_state_seller_id_variant_id_idx" ON "stock_alert_state"("seller_id", "variant_id");

-- CreateIndex
CREATE INDEX "stock_alert_state_variant_id_idx" ON "stock_alert_state"("variant_id");

-- CreateIndex
CREATE INDEX "stock_alert_state_warehouse_id_idx" ON "stock_alert_state"("warehouse_id");

-- CreateIndex
CREATE UNIQUE INDEX "stock_alert_state_seller_id_variant_id_warehouse_id_key" ON "stock_alert_state"("seller_id", "variant_id", "warehouse_id");

-- AddForeignKey
ALTER TABLE "stock_alert_state" ADD CONSTRAINT "stock_alert_state_seller_id_fkey" FOREIGN KEY ("seller_id") REFERENCES "sellers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_alert_state" ADD CONSTRAINT "stock_alert_state_variant_id_fkey" FOREIGN KEY ("variant_id") REFERENCES "product_variants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_alert_state" ADD CONSTRAINT "stock_alert_state_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
