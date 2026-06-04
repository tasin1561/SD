-- Phase 1B follow-up — retarget seller-side token FKs from sellers
-- to seller_users (mirrors the staff pattern: staff_*_tokens.staff_user_id).
--
-- Without this, the post-Phase-1B login flow crashes with a P2003 FK
-- violation: RefreshTokenService.issue writes the sellerUserId into
-- seller_refresh_tokens.seller_id, but that column FKs to sellers.id —
-- the sellerUserId doesn't exist there. Same shape for the password-
-- reset + email-verification token tables (renamed for consistency
-- even though their write callsites haven't migrated yet).
--
-- Backfill: each existing token row points to the seller (company). We
-- backfill the new column to the SELLER's OWNER seller_user (chosen by
-- earliest created_at). Orphan rows (no OWNER for the seller — should
-- not happen after the 20260604040000 backfill, but defensive) are
-- deleted before the NOT NULL constraint lands.

-- ── seller_refresh_tokens ──
ALTER TABLE "seller_refresh_tokens" ADD COLUMN "seller_user_id" UUID;
UPDATE "seller_refresh_tokens" srt
SET "seller_user_id" = (
  SELECT su."id" FROM "seller_users" su
  WHERE su."seller_id" = srt."seller_id"
    AND su."role" = 'owner'
    AND su."deleted_at" IS NULL
  ORDER BY su."created_at" ASC LIMIT 1
);
DELETE FROM "seller_refresh_tokens" WHERE "seller_user_id" IS NULL;
ALTER TABLE "seller_refresh_tokens" DROP CONSTRAINT "seller_refresh_tokens_seller_id_fkey";
DROP INDEX IF EXISTS "seller_refresh_tokens_seller_id_idx";
ALTER TABLE "seller_refresh_tokens" DROP COLUMN "seller_id";
ALTER TABLE "seller_refresh_tokens" ALTER COLUMN "seller_user_id" SET NOT NULL;
ALTER TABLE "seller_refresh_tokens"
  ADD CONSTRAINT "seller_refresh_tokens_seller_user_id_fkey"
    FOREIGN KEY ("seller_user_id") REFERENCES "seller_users"("id") ON DELETE CASCADE;
CREATE INDEX "seller_refresh_tokens_seller_user_id_idx" ON "seller_refresh_tokens"("seller_user_id");

-- ── seller_password_reset_tokens ──
ALTER TABLE "seller_password_reset_tokens" ADD COLUMN "seller_user_id" UUID;
UPDATE "seller_password_reset_tokens" spt
SET "seller_user_id" = (
  SELECT su."id" FROM "seller_users" su
  WHERE su."seller_id" = spt."seller_id"
    AND su."role" = 'owner'
    AND su."deleted_at" IS NULL
  ORDER BY su."created_at" ASC LIMIT 1
);
DELETE FROM "seller_password_reset_tokens" WHERE "seller_user_id" IS NULL;
ALTER TABLE "seller_password_reset_tokens" DROP CONSTRAINT "seller_password_reset_tokens_seller_id_fkey";
DROP INDEX IF EXISTS "seller_password_reset_tokens_seller_id_idx";
ALTER TABLE "seller_password_reset_tokens" DROP COLUMN "seller_id";
ALTER TABLE "seller_password_reset_tokens" ALTER COLUMN "seller_user_id" SET NOT NULL;
ALTER TABLE "seller_password_reset_tokens"
  ADD CONSTRAINT "seller_password_reset_tokens_seller_user_id_fkey"
    FOREIGN KEY ("seller_user_id") REFERENCES "seller_users"("id") ON DELETE CASCADE;
CREATE INDEX "seller_password_reset_tokens_seller_user_id_idx" ON "seller_password_reset_tokens"("seller_user_id");

-- ── seller_email_verification_tokens ──
ALTER TABLE "seller_email_verification_tokens" ADD COLUMN "seller_user_id" UUID;
UPDATE "seller_email_verification_tokens" sev
SET "seller_user_id" = (
  SELECT su."id" FROM "seller_users" su
  WHERE su."seller_id" = sev."seller_id"
    AND su."role" = 'owner'
    AND su."deleted_at" IS NULL
  ORDER BY su."created_at" ASC LIMIT 1
);
DELETE FROM "seller_email_verification_tokens" WHERE "seller_user_id" IS NULL;
ALTER TABLE "seller_email_verification_tokens" DROP CONSTRAINT "seller_email_verification_tokens_seller_id_fkey";
DROP INDEX IF EXISTS "seller_email_verification_tokens_seller_id_idx";
ALTER TABLE "seller_email_verification_tokens" DROP COLUMN "seller_id";
ALTER TABLE "seller_email_verification_tokens" ALTER COLUMN "seller_user_id" SET NOT NULL;
ALTER TABLE "seller_email_verification_tokens"
  ADD CONSTRAINT "seller_email_verification_tokens_seller_user_id_fkey"
    FOREIGN KEY ("seller_user_id") REFERENCES "seller_users"("id") ON DELETE CASCADE;
CREATE INDEX "seller_email_verification_tokens_seller_user_id_idx" ON "seller_email_verification_tokens"("seller_user_id");
