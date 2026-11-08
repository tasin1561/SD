-- AlterTable
ALTER TABLE "orders" ADD COLUMN "confirmation_deadline_at" TIMESTAMPTZ;

-- CreateIndex
CREATE INDEX "orders_confirmation_deadline_at_idx" ON "orders"("confirmation_deadline_at");
