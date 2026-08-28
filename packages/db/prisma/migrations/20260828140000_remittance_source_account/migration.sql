-- Which of OUR accounts a payout left from.
--
-- A remittance already recorded what the seller received and at what
-- rate. It did not record where the money came from, so a wallet debit
-- had no cash behind it and the bank book could not be reconciled
-- against the statement it came from.
--
-- Nullable: rows written before the treasury existed genuinely do not
-- know, and inventing an account for them would be worse than admitting
-- it. Optional relation, so Prisma's default ON DELETE SET NULL is
-- correct here and is what the schema will infer.
ALTER TABLE "remittances" ADD COLUMN "paid_from_account_id" UUID;

ALTER TABLE "remittances"
  ADD CONSTRAINT "remittances_paid_from_account_id_fkey"
  FOREIGN KEY ("paid_from_account_id") REFERENCES "platform_bank_accounts"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
