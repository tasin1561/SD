-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "order_status" ADD VALUE 'out_of_stock';
ALTER TYPE "order_status" ADD VALUE 'cancelled_by_admin';

-- DropIndex
DROP INDEX "customers_phone_e164_key";

-- AlterTable
ALTER TABLE "customers" ADD COLUMN     "seller_id" UUID NOT NULL;

-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "has_admin_override" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX "customers_seller_id_idx" ON "customers"("seller_id");

-- CreateIndex
CREATE INDEX "customers_phone_e164_idx" ON "customers"("phone_e164");

-- CreateIndex
CREATE UNIQUE INDEX "customers_seller_id_phone_e164_key" ON "customers"("seller_id", "phone_e164");

-- AddForeignKey
ALTER TABLE "customers" ADD CONSTRAINT "customers_seller_id_fkey" FOREIGN KEY ("seller_id") REFERENCES "sellers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

