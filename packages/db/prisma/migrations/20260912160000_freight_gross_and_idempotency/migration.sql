-- ─────────────────────────────────────────────────────────────────────
-- 1. A freight line's GROSS total — what the seller owes for it,
--    including its share of the pay-later service charge.
--
-- The allocation lines summed to the PRE-charge bill while the bill's
-- total included the service charge, so amortisation collected every
-- line in full and still closed the bill short by exactly the charge —
-- and `settle` then refused a bill already marked SETTLED. The gross
-- figure is what amortisation now charges against.
--
-- Backfill: each line's share of the bill total, rounded to the paisa,
-- with the rounding residue on the bill's largest line so the lines sum
-- to `total_inr` EXACTLY. PAY_NOW bills carry no service charge, so their
-- gross is their line total.
-- ─────────────────────────────────────────────────────────────────────
ALTER TABLE "inbound_freight_allocations" ADD COLUMN "line_gross_inr" DECIMAL(12,2);

WITH shares AS (
  SELECT
    a.id,
    a.freight_charge_id,
    CASE
      WHEN c.amount_inr = 0 THEN a.line_total_inr
      ELSE ROUND(a.line_total_inr * c.total_inr / c.amount_inr, 2)
    END AS gross,
    c.total_inr,
    ROW_NUMBER() OVER (
      PARTITION BY a.freight_charge_id
      ORDER BY a.line_total_inr DESC, a.id DESC
    ) AS rn
  FROM "inbound_freight_allocations" a
  JOIN "inbound_freight_charges" c ON c.id = a.freight_charge_id
),
sums AS (
  SELECT freight_charge_id, SUM(gross) AS summed, MAX(total_inr) AS total
  FROM shares
  GROUP BY freight_charge_id
)
UPDATE "inbound_freight_allocations" a
SET line_gross_inr = sh.gross + CASE WHEN sh.rn = 1 THEN su.total - su.summed ELSE 0 END
FROM shares sh
JOIN sums su ON su.freight_charge_id = sh.freight_charge_id
WHERE a.id = sh.id;

ALTER TABLE "inbound_freight_allocations" ALTER COLUMN "line_gross_inr" SET NOT NULL;

-- A PAY_NOW bill was charged its whole total at record time; its lines
-- are fully charged by definition, in gross terms too.
UPDATE "inbound_freight_allocations" a
SET amount_settled_inr = a.line_gross_inr
FROM "inbound_freight_charges" c
WHERE c.id = a.freight_charge_id
  AND c.mode = 'pay_now';

-- ─────────────────────────────────────────────────────────────────────
-- 2. Pay-later bills that amortisation closed SHORT of their total.
--
-- Every unit left, the lines were fully charged at their pre-charge
-- totals, and the bill was stamped SETTLED with the service charge never
-- taken. `settle` refuses a SETTLED bill, so nothing could collect it.
-- Reopened as PARTIALLY_SETTLED so the outstanding service charge shows
-- on /freight and "Settle" collects exactly it. Identified precisely:
-- a bill settled by hand carries its wallet entry and a settled amount
-- equal to its total; one settled by amortisation carries neither.
-- ─────────────────────────────────────────────────────────────────────
UPDATE "inbound_freight_charges"
SET status = 'partially_settled', settled_at = NULL, settled_by_staff_id = NULL
WHERE mode = 'pay_later'
  AND status = 'settled'
  AND wallet_entry_id IS NULL
  AND amount_settled_inr < total_inr;

-- ─────────────────────────────────────────────────────────────────────
-- 3. Idempotency keys on the rows a person's form creates.
--
-- IF NOT EXISTS because the same column on bank_entries is the shared
-- contract for every treasury write (transfers, remittances, owner
-- money use it too) and may already have been added by a sibling
-- migration.
-- ─────────────────────────────────────────────────────────────────────
ALTER TABLE "bank_entries" ADD COLUMN IF NOT EXISTS "idempotency_key" UUID;
CREATE UNIQUE INDEX IF NOT EXISTS "bank_entries_idempotency_key_key"
  ON "bank_entries"("idempotency_key");

ALTER TABLE "investments" ADD COLUMN IF NOT EXISTS "idempotency_key" UUID;
CREATE UNIQUE INDEX IF NOT EXISTS "investments_idempotency_key_key"
  ON "investments"("idempotency_key");
