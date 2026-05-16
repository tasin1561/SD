-- CreateTable
CREATE TABLE "stock_adjustment_lines" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "adjustment_id" UUID NOT NULL,
    "variant_id" UUID NOT NULL,
    "bin_id" UUID NOT NULL,
    "batch_id" UUID,
    "qty_change" INTEGER NOT NULL,
    "unit_cost_inr" DECIMAL(12,2),
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "stock_adjustment_lines_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "stock_adjustment_lines_adjustment_id_idx" ON "stock_adjustment_lines"("adjustment_id");

-- CreateIndex
CREATE INDEX "stock_adjustment_lines_variant_id_idx" ON "stock_adjustment_lines"("variant_id");

-- CreateIndex
CREATE INDEX "stock_adjustment_lines_bin_id_idx" ON "stock_adjustment_lines"("bin_id");

-- CreateIndex
CREATE INDEX "stock_adjustment_lines_batch_id_idx" ON "stock_adjustment_lines"("batch_id");

-- AddForeignKey
ALTER TABLE "stock_adjustment_lines" ADD CONSTRAINT "stock_adjustment_lines_adjustment_id_fkey" FOREIGN KEY ("adjustment_id") REFERENCES "stock_adjustments"("id") ON DELETE CASCADE ON UPDATE CASCADE;
