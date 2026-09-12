-- A seller's money in a NON-RUPEE account carries its rupee BOOK value.
--
-- Their taka used to be valued at ONE rate — their latest accepted top-up
-- into that account — so two top-ups at ₹0.70 and ₹0.80 a taka read as
-- ৳2,000 × 0.80 = ₹1,600 against a ₹1,500 wallet, and a ₹1,500 charge took
-- ৳1,875 and left ৳125 "theirs" for a wallet at zero. Summed per account,
-- `inr_book_value` is exactly what their wallet holds for that money;
-- units ÷ book is their weighted-average rate, and a charge takes units at
-- it, so the book follows the wallet to the paisa.
--
-- Also: `remittance_id`, linking each bank entry a payout writes to it, so
-- the P&L can convert a payout's realised FX at THAT payout's rate.

ALTER TABLE "bank_entries" ADD COLUMN "inr_book_value" DECIMAL(14,2);
ALTER TABLE "bank_entries" ADD COLUMN "remittance_id" UUID;

ALTER TABLE "bank_entries"
  ADD CONSTRAINT "bank_entries_remittance_id_fkey"
  FOREIGN KEY ("remittance_id") REFERENCES "remittances"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "bank_entries_remittance_id_idx" ON "bank_entries"("remittance_id");

-- ─────────────────────────────────────────────────────────────────────
-- Backfill. Deterministic, and only over SELLER rows in non-rupee
-- accounts (rupees are their own value; capital is not tracked against a
-- wallet). Production had NO seller-held taka on 2026-09-12 (Menev Store
-- ₹511.40 held, all rupees; QA Test Traders nothing), so every group
-- below should net to 0 units and 0 book — and step 4 refuses the deploy
-- if one does not.
-- ─────────────────────────────────────────────────────────────────────

-- 1. A top-up is worth exactly what the wallet was credited for it.
UPDATE "bank_entries" be
SET "inr_book_value" = we."amount"
FROM "wallet_topup_requests" t
JOIN "seller_wallet_entries" we ON we."id" = t."wallet_entry_id"
WHERE be."topup_request_id" = t."id"
  AND be."owner_kind" = 'seller'
  AND be."currency" <> 'inr'
  AND be."type" = 'seller_topup'
  AND be."inr_book_value" IS NULL;

-- 2. Everything else at the rate the code of the day valued it at: the
--    latest accepted top-up by that seller into that account, as of when
--    the row was written; failing that, the system rate.
WITH rated AS (
  SELECT
    be."id",
    COALESCE(
      (
        SELECT we."amount" / t."amount"
        FROM "wallet_topup_requests" t
        JOIN "seller_wallet_entries" we ON we."id" = t."wallet_entry_id"
        WHERE t."seller_id" = be."seller_id"
          AND t."bank_account_id" = be."account_id"
          AND t."currency" = be."currency"
          AND t."status" = 'accepted'
          AND t."amount" > 0
          AND we."amount" > 0
          AND t."reviewed_at" <= be."created_at"
        ORDER BY t."reviewed_at" DESC, t."id" DESC
        LIMIT 1
      ),
      (
        SELECT CASE WHEN f."from_currency" = be."currency" THEN f."rate" ELSE 1 / f."rate" END
        FROM "fx_rates" f
        WHERE f."rate" > 0
          AND (
            (f."from_currency" = be."currency" AND f."to_currency" = 'inr')
            OR (f."from_currency" = 'inr' AND f."to_currency" = be."currency")
          )
        LIMIT 1
      )
    ) AS "rate"
  FROM "bank_entries" be
  WHERE be."owner_kind" = 'seller'
    AND be."currency" <> 'inr'
    AND be."inr_book_value" IS NULL
)
UPDATE "bank_entries" be
SET "inr_book_value" = ROUND(be."signed_amount" * rated."rate", 2)
FROM rated
WHERE rated."id" = be."id"
  AND rated."rate" IS NOT NULL;

-- 3. A holding that is fully spent (0 units) must be worth exactly 0. Two
--    rates meeting in one account leave a sub-rupee residue; it goes on
--    the LATEST row of that holding, as a live charge's residue would.
WITH spent AS (
  SELECT
    "seller_id",
    "account_id",
    COALESCE(SUM("inr_book_value"), 0) AS "book",
    (ARRAY_AGG("id" ORDER BY "id" DESC))[1] AS "last_id"
  FROM "bank_entries"
  WHERE "owner_kind" = 'seller' AND "currency" <> 'inr'
  GROUP BY "seller_id", "account_id"
  HAVING SUM("signed_amount") = 0 AND COALESCE(SUM("inr_book_value"), 0) <> 0
)
UPDATE "bank_entries" be
SET "inr_book_value" = COALESCE(be."inr_book_value", 0) - spent."book"
FROM spent
WHERE be."id" = spent."last_id";

-- 4. Self-check. A spent holding still carrying book value is exactly the
--    stranded money this column exists to prevent: refuse the deploy.
DO $$
DECLARE
  bad integer;
  unvalued integer;
BEGIN
  SELECT COUNT(*) INTO bad FROM (
    SELECT 1
    FROM "bank_entries"
    WHERE "owner_kind" = 'seller' AND "currency" <> 'inr'
    GROUP BY "seller_id", "account_id"
    HAVING SUM("signed_amount") = 0 AND COALESCE(SUM("inr_book_value"), 0) <> 0
  ) x;
  IF bad > 0 THEN
    RAISE EXCEPTION 'inr_book_value backfill: % spent seller holding(s) still carry book value', bad;
  END IF;

  SELECT COUNT(*) INTO unvalued
  FROM "bank_entries"
  WHERE "owner_kind" = 'seller' AND "currency" <> 'inr' AND "inr_book_value" IS NULL;
  IF unvalued > 0 THEN
    RAISE NOTICE 'inr_book_value backfill: % seller row(s) in non-rupee accounts had no rate to value them and are left NULL', unvalued;
  END IF;
END $$;
