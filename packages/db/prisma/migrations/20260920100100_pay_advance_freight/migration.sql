-- PAY_ADVANCE inbound freight: the mode snapshot, the agreed currency,
-- the void columns, and the double-billing guard.
--
-- PAY_ADVANCE is not a new billing MECHANISM. The invoice is still priced
-- line by line, per kg or per piece, at a rate ops types after the count.
-- What changes is WHICH goods receipt the bill hangs on — the Bangladesh
-- intake rather than the India arrival — and therefore WHEN it is raised.

-- ─────────────────────────────────────────────────────────────────────
-- The THIRD level of the freight-mode chain, on the consignment:
--
--     consignment override  ??  seller override  ??  global default
--
-- The last two already exist and are untouched — `wallet.inbound_freight_mode`
-- is a seller-overridable SET-1 string. This column is the per-shipment
-- pin, set at BD receiving (the moment the three modes diverge: bill it
-- here, or bill it when it lands).
--
-- NULL means FALL THROUGH, and that is the ordinary state. It is not a
-- default and must not be backfilled into one: a consignment nobody has
-- made a per-shipment decision about should follow whatever the seller's
-- terms are today.
--
-- The column becomes a SNAPSHOT the moment the bill is raised — the
-- billing transaction writes the effective mode into it and
-- `setOverride` refuses thereafter (`FREIGHT_MODE_LOCKED`), so a later
-- change to the seller's setting or the global default can never
-- re-characterise a consignment already billed or in the air (ORD-6 /
-- RS-5).
-- ─────────────────────────────────────────────────────────────────────

-- AlterTable
ALTER TABLE "consignments" ADD COLUMN     "inbound_freight_mode" "inbound_freight_mode";

-- Backfill ONLY what is already settled: a consignment that carries a
-- freight bill was billed on that bill's own mode, and freezing it here
-- is exactly the snapshot the billing transaction will write from now
-- on. Every other consignment is left NULL to fall through, which is
-- what the chain means.
--
-- The newest bill wins where a consignment carries several (a
-- consignment can land in more than one shipment, CNS-6) — they share a
-- mode in practice, and the latest is the one that described the terms
-- most recently.
UPDATE "consignments" c
SET "inbound_freight_mode" = f."mode"
FROM (
  SELECT DISTINCT ON ("consignment_id") "consignment_id", "mode"
    FROM "inbound_freight_charges"
   ORDER BY "consignment_id", "created_at" DESC
) f
WHERE f."consignment_id" = c."id" AND c."inbound_freight_mode" IS NULL;

-- ─────────────────────────────────────────────────────────────────────
-- The bill as AGREED, and the rate that turned it into rupees.
--
-- The rate is agreed by phone and typed at billing time; "৳300 a kilo" is
-- a fact about the deal and must survive the exchange rate moving. PRC-8
-- already holds this shape for the flat fees: record the source amount,
-- its currency, and the rate, pair and recorded-at used, or "why was I
-- billed ₹4,065?" is unanswerable once the rate has moved.
-- ─────────────────────────────────────────────────────────────────────

-- AlterTable
--
-- `agreed_amount` is added NULLABLE, backfilled, then made NOT NULL.
-- Generated DDL would add it `NOT NULL` outright, which fails on a table
-- that already has rows. Every existing bill was priced in rupees, so its
-- agreed amount IS its `amount_inr`, and `agreed_currency` defaults to
-- 'inr' — which is why those rows need no FX stamp.
ALTER TABLE "inbound_freight_charges" ADD COLUMN     "agreed_amount" DECIMAL(12,2),
ADD COLUMN     "agreed_currency" "currency" NOT NULL DEFAULT 'inr',
ADD COLUMN     "fx_rate" DECIMAL(18,8),
ADD COLUMN     "fx_rate_pair" TEXT,
ADD COLUMN     "fx_rate_recorded_at" TIMESTAMPTZ,
ADD COLUMN     "fx_rate_source" TEXT,
ADD COLUMN     "void_reason" TEXT,
ADD COLUMN     "void_reversal_entry_id" UUID,
ADD COLUMN     "voided_at" TIMESTAMPTZ,
ADD COLUMN     "voided_by_staff_id" UUID;

UPDATE "inbound_freight_charges" SET "agreed_amount" = "amount_inr" WHERE "agreed_amount" IS NULL;

ALTER TABLE "inbound_freight_charges" ALTER COLUMN "agreed_amount" SET NOT NULL;

-- ─────────────────────────────────────────────────────────────────────
-- The allocation's rate, RENAMED rather than replaced.
--
-- Generated DDL reads this as a DROP plus an ADD, because Prisma cannot
-- know a column was renamed — and that would throw away the rate on every
-- freight line ever recorded. It is a rename: the values are unchanged,
-- and for every existing (INR) bill the new name is simply more honest
-- about what the number will mean from now on.
--
-- The rename is the load-bearing half of the currency change on the code
-- side too: `rateInr` was rupees for the whole life of this table, so a
-- reader that kept treating it as rupees would show ৳300 as ₹300 and
-- typecheck clean. Renaming makes every such site fail to compile.
-- ─────────────────────────────────────────────────────────────────────

-- AlterTable
ALTER TABLE "inbound_freight_allocations" RENAME COLUMN "rate_inr" TO "rate";

-- `line_total_agreed` — the invoice line in the currency it was typed in.
-- Nullable, backfilled, NOT NULL, for the same reason as `agreed_amount`:
-- every existing line was priced in rupees, so its agreed total is its
-- `line_total_inr`.
ALTER TABLE "inbound_freight_allocations" ADD COLUMN     "line_total_agreed" DECIMAL(12,2);

UPDATE "inbound_freight_allocations" SET "line_total_agreed" = "line_total_inr" WHERE "line_total_agreed" IS NULL;

ALTER TABLE "inbound_freight_allocations" ALTER COLUMN "line_total_agreed" SET NOT NULL;

-- ─────────────────────────────────────────────────────────────────────
-- Void plumbing.
-- ─────────────────────────────────────────────────────────────────────

-- CreateIndex
CREATE UNIQUE INDEX "inbound_freight_charges_void_reversal_entry_id_key" ON "inbound_freight_charges"("void_reversal_entry_id");

-- CreateIndex
CREATE INDEX "inbound_freight_charges_voided_by_staff_id_idx" ON "inbound_freight_charges"("voided_by_staff_id");

-- AddForeignKey
ALTER TABLE "inbound_freight_charges" ADD CONSTRAINT "inbound_freight_charges_voided_by_staff_id_fkey" FOREIGN KEY ("voided_by_staff_id") REFERENCES "staff_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inbound_freight_charges" ADD CONSTRAINT "inbound_freight_charges_void_reversal_entry_id_fkey" FOREIGN KEY ("void_reversal_entry_id") REFERENCES "seller_wallet_entries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ─────────────────────────────────────────────────────────────────────
-- THE DOUBLE-BILLING GUARD (the database's half).
--
-- A consignment billed in advance at Dhaka must NOT be billable again at
-- the India arrival. `goods_receipt_id @unique` cannot see that: the
-- intake and the arrival are DIFFERENT receipts, so both bills would be
-- accepted and the seller charged twice for one consignment.
--
-- This index makes a second LIVE advance bill on one consignment
-- unrepresentable. Prisma cannot express a partial index, so it is
-- written by hand here; the drift check ignores indexes it cannot model,
-- which is why the estate's other partial uniques (pack_boxes,
-- courier_pickup_requests, the once-per-order wallet index) live this way
-- too.
--
-- It is the SECOND gate, not the first. The application's gate is
-- `InboundFreightService.record`, which refuses any second bill on a
-- consignment already billed in advance — and refuses an advance bill on
-- a consignment that already carries any live bill, which no index can
-- express — under `AdvisoryLock.INBOUND_FREIGHT_BILL` inside the writing
-- transaction. This is what still holds when the code forgets.
-- ─────────────────────────────────────────────────────────────────────

-- CreateIndex
CREATE UNIQUE INDEX "inbound_freight_one_advance_per_consignment"
  ON "inbound_freight_charges" ("consignment_id")
  WHERE "mode" = 'pay_advance' AND "voided_at" IS NULL;

-- ─────────────────────────────────────────────────────────────────────
-- The setting now has a third value, so its description says so.
-- seedSystemSettings() is create-only on the value columns, so a seed
-- edit alone would never move the deployed row.
-- ─────────────────────────────────────────────────────────────────────

UPDATE "system_settings"
SET "description" =
  'Who fronts the BD→India freight bill, and WHEN it is raised. ' ||
  '''PAY_ADVANCE'' — billed at the Bangladesh intake once Dhaka has counted and weighed, debited in full there and then, before the goods fly. ' ||
  '''PAY_NOW'' (default) — billed at the India arrival and debited in full. ' ||
  '''PAY_LATER'' — billed at the India arrival and carried as a receivable, charged per unit as stock sells, optionally with a service charge. ' ||
  'Per-seller override; whatever applies is SNAPSHOTTED onto each consignment when it is declared, so changing this never re-bills a consignment already in the air.'
WHERE "key" = 'wallet.inbound_freight_mode';
