-- ─────────────────────────────────────────────────────────────────────
-- 1. Idempotency keys on the rows an operator's form creates.
--
-- A retried POST — a double-click, a timeout the browser retried — used to
-- record the transfer, the payout or the owner's money twice. The admin
-- form sends one key per opening of the modal; a replay with the same key
-- returns the original and moves nothing.
--
-- bank_entries' column is SHARED with 20260912160000 (investments,
-- forwarder and courier-wallet payments), which adds the identical column
-- and index: IF NOT EXISTS so whichever runs second is a no-op.
-- ─────────────────────────────────────────────────────────────────────
ALTER TABLE "bank_entries" ADD COLUMN IF NOT EXISTS "idempotency_key" UUID;
CREATE UNIQUE INDEX IF NOT EXISTS "bank_entries_idempotency_key_key"
  ON "bank_entries"("idempotency_key");

ALTER TABLE "bank_transfers" ADD COLUMN IF NOT EXISTS "idempotency_key" UUID;
CREATE UNIQUE INDEX IF NOT EXISTS "bank_transfers_idempotency_key_key"
  ON "bank_transfers"("idempotency_key");

ALTER TABLE "remittances" ADD COLUMN IF NOT EXISTS "idempotency_key" UUID;
CREATE UNIQUE INDEX IF NOT EXISTS "remittances_idempotency_key_key"
  ON "remittances"("idempotency_key");

-- ─────────────────────────────────────────────────────────────────────
-- 2. The OPENING balance is marked, not inferred.
--
-- The P&L took an account's FIRST capital entry as its opening balance.
-- Charges, transfers and remittances now post capital rows by themselves,
-- so on a new account a system reclassification can come first and a real
-- opening balance then reads as ~₹81,000 of "bank reconciliation" income.
-- The operator now says so when reconciling, and the P&L reads the mark.
-- ─────────────────────────────────────────────────────────────────────
ALTER TABLE "bank_entries"
  ADD COLUMN "is_opening_balance" BOOLEAN NOT NULL DEFAULT false;

-- What the P&L treated as the opening balance until today: an account's
-- first CAPITAL entry, when it is a reconciliation (Tasin City's ৳100,000
-- "Initial Balance") or the entry written when the account was added.
-- Only the first capital entry can qualify, so this marks at most one
-- per account and the P&L's figures do not move.
UPDATE "bank_entries" be
SET "is_opening_balance" = true
WHERE be."owner_kind" = 'capital'
  AND be."type" IN ('reconciliation_adjustment', 'opening_balance')
  AND NOT EXISTS (
    SELECT 1
    FROM "bank_entries" e
    WHERE e."account_id" = be."account_id"
      AND e."owner_kind" = 'capital'
      AND e."id" < be."id"
  );

-- One opening balance per account, held by the database rather than by a
-- check a concurrent request could slip past. Migration-only: Prisma
-- cannot express a partial unique.
CREATE UNIQUE INDEX "bank_entries_one_opening_balance_per_account"
  ON "bank_entries"("account_id")
  WHERE "is_opening_balance";

DO $$
DECLARE
  flagged integer;
BEGIN
  SELECT COUNT(*) INTO flagged FROM "bank_entries" WHERE "is_opening_balance";
  RAISE NOTICE 'opening balances marked: %', flagged;
END $$;
