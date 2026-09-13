-- Staff wallet transfers (2026-09-13): a member of staff debits or credits
-- a seller's wallet on purpose, with a reason the seller reads, and the
-- cash behind it moves (TRE-8). Distinct from ADJUSTMENT_*, which move none.
ALTER TYPE "wallet_entry_direction" ADD VALUE IF NOT EXISTS 'staff_debit';
ALTER TYPE "wallet_entry_direction" ADD VALUE IF NOT EXISTS 'staff_credit';

-- IDEM-1: the operator form's key, one per opening of the form.
ALTER TABLE "seller_wallet_entries" ADD COLUMN IF NOT EXISTS "idempotency_key" UUID;
CREATE UNIQUE INDEX IF NOT EXISTS "seller_wallet_entries_idempotency_key_key"
  ON "seller_wallet_entries"("idempotency_key");
