-- Every line of the courier's wallet ledger, kept.
--
-- The import used to keep only the LATEST successful debit per AWB and
-- write it as that parcel's cost. Delhivery charges, reverses and
-- re-charges the same waybill, so across 90 days of real data that was
-- wrong for 705 of 11,389 parcels — always OVERSTATING, by ₹67,614
-- against a true total of ₹775,577. The clearest cases are parcels
-- charged and then fully reversed: net zero, recorded as full freight.
--
-- A parcel's cost is the sum of its debits minus its credits, which can
-- only be computed from the rows. So the rows are what we keep, and
-- `shipments.actual_*_cost_inr` becomes a stamped derivation of them.
CREATE TYPE "courier_wallet_txn_kind" AS ENUM ('debit', 'credit');
CREATE TYPE "courier_wallet_txn_category" AS ENUM ('parcel', 'adjustment');
CREATE TYPE "courier_wallet_txn_leg" AS ENUM ('forward', 'rto');

CREATE TABLE "courier_wallet_transactions" (
  "id"                 UUID NOT NULL DEFAULT uuidv7(),
  "courier_account_id" UUID NOT NULL,
  "txn_id"             TEXT NOT NULL,
  "awb_number"         TEXT,
  "kind"               "courier_wallet_txn_kind" NOT NULL,
  "category"           "courier_wallet_txn_category" NOT NULL,
  "leg"                "courier_wallet_txn_leg" NOT NULL,
  "amount_inr"         DECIMAL(12,2) NOT NULL,
  "occurred_at"        TIMESTAMPTZ NOT NULL,
  "status"             TEXT NOT NULL,
  "shipment_status"    TEXT,
  "detail"             JSONB,
  "first_seen_at"      TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "last_seen_at"       TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "courier_wallet_transactions_pkey" PRIMARY KEY ("id")
);

-- THE identity the whole import rests on: their txn id, per account. A
-- re-import inserts what is new and touches nothing else.
CREATE UNIQUE INDEX "courier_wallet_transactions_courier_account_id_txn_id_key"
  ON "courier_wallet_transactions" ("courier_account_id", "txn_id");

-- The cost query: every transaction for one parcel.
CREATE INDEX "courier_wallet_transactions_awb_number_idx"
  ON "courier_wallet_transactions" ("awb_number");
-- The P&L query: adjustments in a period.
CREATE INDEX "courier_wallet_transactions_category_occurred_at_idx"
  ON "courier_wallet_transactions" ("category", "occurred_at");
CREATE INDEX "courier_wallet_transactions_courier_account_id_occurred_at_idx"
  ON "courier_wallet_transactions" ("courier_account_id", "occurred_at");

ALTER TABLE "courier_wallet_transactions"
  ADD CONSTRAINT "courier_wallet_transactions_courier_account_id_fkey"
  FOREIGN KEY ("courier_account_id") REFERENCES "courier_accounts"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
