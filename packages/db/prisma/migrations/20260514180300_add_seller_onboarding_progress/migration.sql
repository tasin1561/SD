-- CreateEnum
CREATE TYPE "seller_onboarding_step" AS ENUM ('registration_completed', 'email_verified', 'company_info_filled', 'bd_origin_address_added', 'in_return_address_added', 'bd_office_address_added', 'bank_details_added', 'notification_prefs_reviewed');

-- CreateEnum
CREATE TYPE "onboarding_step_actor" AS ENUM ('system', 'seller', 'admin');

-- CreateTable
CREATE TABLE "seller_onboarding_progress" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "seller_id" UUID NOT NULL,
    "step_code" "seller_onboarding_step" NOT NULL,
    "is_required" BOOLEAN NOT NULL DEFAULT true,
    "completed_at" TIMESTAMPTZ,
    "completed_by" "onboarding_step_actor",
    "metadata" JSONB,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "seller_onboarding_progress_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "seller_onboarding_progress_seller_id_idx" ON "seller_onboarding_progress"("seller_id");

-- CreateIndex
CREATE INDEX "seller_onboarding_progress_step_code_idx" ON "seller_onboarding_progress"("step_code");

-- CreateIndex
CREATE INDEX "seller_onboarding_progress_completed_at_idx" ON "seller_onboarding_progress"("completed_at");

-- CreateIndex
CREATE UNIQUE INDEX "seller_onboarding_progress_seller_id_step_code_key" ON "seller_onboarding_progress"("seller_id", "step_code");

-- AddForeignKey
ALTER TABLE "seller_onboarding_progress" ADD CONSTRAINT "seller_onboarding_progress_seller_id_fkey" FOREIGN KEY ("seller_id") REFERENCES "sellers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
