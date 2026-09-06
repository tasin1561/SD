-- Delhivery's wallet is PREPAID: we send money, they issue waybills
-- against it. Every rupee in there left one of our bank accounts, and
-- nothing checked that the two sides agreed — money could leave the
-- treasury labelled "courier recharge" and never arrive, and the only
-- symptom would be a balance running out sooner than expected.
--
-- Their recharge list carries the BANK's own transaction id beside
-- theirs, so the match is an exact reference comparison rather than a
-- guess at amount and date (which would pair two 20,000 recharges on the
-- same morning arbitrarily and call it reconciled).

ALTER TYPE "bank_entry_type" ADD VALUE IF NOT EXISTS 'courier_wallet_recharge';

CREATE TYPE "courier_recharge_match" AS ENUM (
  'matched', 'unrecorded', 'amount_mismatch', 'resolved'
);

CREATE TABLE "courier_wallet_recharges" (
    "id"                  UUID NOT NULL DEFAULT uuidv7(),
    "courier_account_id"  UUID NOT NULL,
    "external_txn_id"     TEXT NOT NULL,
    "bank_txn_ref"        TEXT,
    "amount_inr"          DECIMAL(14,2) NOT NULL,
    "status"              TEXT NOT NULL,
    "occurred_at"         TIMESTAMPTZ NOT NULL,
    "bank_entry_id"       UUID,
    "match_state"         "courier_recharge_match" NOT NULL DEFAULT 'unrecorded',
    "resolved_by_staff_id" UUID,
    "resolved_at"         TIMESTAMPTZ,
    "resolution_note"     TEXT,
    "first_seen_at"       TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at"        TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "courier_wallet_recharges_pkey" PRIMARY KEY ("id")
);

-- THEIR id is the dedup key: a nightly re-read of the same window must
-- restate a recharge, never record a second one.
CREATE UNIQUE INDEX "courier_wallet_recharges_courier_account_id_external_txn_id_key"
  ON "courier_wallet_recharges" ("courier_account_id", "external_txn_id");
-- One bank payment funds ONE recharge. Letting a single entry answer for
-- two would hide exactly the shortfall this table exists to find.
CREATE UNIQUE INDEX "courier_wallet_recharges_bank_entry_id_key"
  ON "courier_wallet_recharges" ("bank_entry_id");
CREATE INDEX "courier_wallet_recharges_match_state_idx"
  ON "courier_wallet_recharges" ("match_state");
CREATE INDEX "courier_wallet_recharges_occurred_at_idx"
  ON "courier_wallet_recharges" ("occurred_at");
CREATE INDEX "courier_wallet_recharges_bank_txn_ref_idx"
  ON "courier_wallet_recharges" ("bank_txn_ref");

ALTER TABLE "courier_wallet_recharges"
  ADD CONSTRAINT "courier_wallet_recharges_courier_account_id_fkey"
    FOREIGN KEY ("courier_account_id") REFERENCES "courier_accounts"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "courier_wallet_recharges"
  ADD CONSTRAINT "courier_wallet_recharges_bank_entry_id_fkey"
    FOREIGN KEY ("bank_entry_id") REFERENCES "bank_entries"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "courier_wallet_recharges"
  ADD CONSTRAINT "courier_wallet_recharges_resolved_by_staff_id_fkey"
    FOREIGN KEY ("resolved_by_staff_id") REFERENCES "staff_users"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- A SNAPSHOT per read, not a single current figure: "how fast are we
-- burning it" decides when to top up, and one number cannot answer it.
CREATE TABLE "courier_wallet_balances" (
    "id"                 UUID NOT NULL DEFAULT uuidv7(),
    "courier_account_id" UUID NOT NULL,
    "balance_inr"        DECIMAL(14,2) NOT NULL,
    "total_credit_inr"   DECIMAL(14,2),
    "total_debit_inr"    DECIMAL(14,2),
    "captured_at"        TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "courier_wallet_balances_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "courier_wallet_balances_courier_account_id_captured_at_idx"
  ON "courier_wallet_balances" ("courier_account_id", "captured_at");

ALTER TABLE "courier_wallet_balances"
  ADD CONSTRAINT "courier_wallet_balances_courier_account_id_fkey"
    FOREIGN KEY ("courier_account_id") REFERENCES "courier_accounts"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
