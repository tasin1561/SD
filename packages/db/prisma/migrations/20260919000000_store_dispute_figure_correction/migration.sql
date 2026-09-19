-- CreateEnum
CREATE TYPE "store_dispute_kind" AS ENUM ('general', 'figure_correction');

-- AlterTable
ALTER TABLE "tickets" ADD COLUMN     "dispute_claim_amount_inr" DECIMAL(14,2),
ADD COLUMN     "dispute_claim_payer" "reseller_money_party",
ADD COLUMN     "dispute_kind" "store_dispute_kind",
ADD COLUMN     "disputed_figures" JSONB;
