-- The payout link belonged on the COURIER, not on the bank account.
--
-- `platform_bank_accounts.courier_account_id` had the cardinality
-- backwards: one of our accounts could name one courier, while a
-- courier could be named by many accounts. Reality is the reverse — a
-- courier pays us into one account, and one account of ours receives
-- from every courier we use. An operator with a single current account
-- could therefore link it to Delhivery OR Shiprocket but never both,
-- and the second courier's settlements were refused with
-- SETTLEMENT_NO_RECEIVING_ACCOUNT for a link they had no way to make.
--
-- The old shape also left the receiving account AMBIGUOUS: the
-- settlement resolved it with an unordered `findFirst`, so two accounts
-- naming one courier would send the cash to whichever row came back
-- first. On the new side the courier owns a single nullable FK, so the
-- question has exactly one answer by construction.
ALTER TABLE "courier_accounts"
  ADD COLUMN "payout_bank_account_id" UUID;

ALTER TABLE "courier_accounts"
  ADD CONSTRAINT "courier_accounts_payout_bank_account_id_fkey"
  FOREIGN KEY ("payout_bank_account_id")
  REFERENCES "platform_bank_accounts"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "courier_accounts_payout_bank_account_id_idx"
  ON "courier_accounts"("payout_bank_account_id");

-- Carry every existing link across before dropping the old column.
-- DISTINCT ON keeps this deterministic where the old shape allowed more
-- than one account to claim a courier: oldest wins, rather than the
-- arbitrary row the old lookup happened to return.
UPDATE "courier_accounts" c
SET "payout_bank_account_id" = picked.id
FROM (
  SELECT DISTINCT ON ("courier_account_id") "courier_account_id", "id"
  FROM "platform_bank_accounts"
  WHERE "courier_account_id" IS NOT NULL AND "deleted_at" IS NULL
  ORDER BY "courier_account_id", "created_at" ASC
) AS picked
WHERE c."id" = picked."courier_account_id";

DROP INDEX IF EXISTS "platform_bank_accounts_courier_account_id_idx";

ALTER TABLE "platform_bank_accounts"
  DROP CONSTRAINT IF EXISTS "platform_bank_accounts_courier_account_id_fkey";

ALTER TABLE "platform_bank_accounts"
  DROP COLUMN "courier_account_id";
