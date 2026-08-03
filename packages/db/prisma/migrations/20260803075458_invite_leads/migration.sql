-- CreateEnum
CREATE TYPE "invite_lead_status" AS ENUM ('new', 'contacted', 'qualified', 'converted', 'declined', 'spam');

-- AlterTable
ALTER TABLE "platform_bank_accounts" ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "staged_order_rows" ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "wallet_topup_requests" ALTER COLUMN "updated_at" DROP DEFAULT;

-- CreateTable
CREATE TABLE "invite_leads" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "full_name" TEXT NOT NULL,
    "company_name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "product_types" TEXT,
    "monthly_orders" TEXT,
    "message" TEXT,
    "status" "invite_lead_status" NOT NULL DEFAULT 'new',
    "notes" TEXT,
    "contacted_at" TIMESTAMPTZ,
    "converted_seller_id" UUID,
    "submission_count" INTEGER NOT NULL DEFAULT 1,
    "ip_address" INET,
    "user_agent" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "invite_leads_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "invite_leads_status_created_at_idx" ON "invite_leads"("status", "created_at");

-- CreateIndex
CREATE INDEX "invite_leads_created_at_idx" ON "invite_leads"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "invite_leads_email_key" ON "invite_leads"("email");

-- AddForeignKey
ALTER TABLE "invite_leads" ADD CONSTRAINT "invite_leads_converted_seller_id_fkey" FOREIGN KEY ("converted_seller_id") REFERENCES "sellers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
