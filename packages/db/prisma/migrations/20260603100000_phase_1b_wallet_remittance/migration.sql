-- Phase 1B M21+M23 — Seller wallet + ledger primitive + admin remittance.
--
-- Additive only: no existing table is touched, no constraint is dropped.
-- The CLAUDE.md invariants (ORD/INV/CC/WMS/CUR/TRK/NOTIF/FE) are all
-- preserved; this migration introduces wallet & remittance as new
-- domains independent of every existing module.
--
-- W-1 (append-only): no UPDATE / DELETE path is added to
-- seller_wallet_entries. Corrections are NEW rows with
-- direction=ADJUSTMENT_* + linked_entry_id pointing at the original.
-- (The DB doesn't enforce append-only — that's a service-layer rule;
-- WalletService is the sole writer.)

-- ── Enum ──────────────────────────────────────────────────────────────
CREATE TYPE "wallet_entry_direction" AS ENUM (
  'cod_collection',
  'order_charges',
  'remittance_out',
  'remittance_fx',
  'adjustment_credit',
  'adjustment_debit',
  'opening_balance'
);

-- ── seller_wallet_entries — the append-only ledger ────────────────────
CREATE TABLE "seller_wallet_entries" (
  "id"                    UUID NOT NULL DEFAULT uuidv7(),
  "seller_id"             UUID NOT NULL,
  "currency"              "currency" NOT NULL,
  "direction"             "wallet_entry_direction" NOT NULL,
  "amount"                DECIMAL(14, 2) NOT NULL,
  "running_balance_after" DECIMAL(14, 2) NOT NULL,
  "linked_order_id"       UUID,
  "linked_remittance_id"  UUID,
  "linked_entry_id"       UUID,
  "reason_code"           TEXT,
  "note"                  TEXT,
  "actor_type"            "actor_type" NOT NULL,
  "actor_id"              UUID,
  "fx_rate_snapshot"      DECIMAL(18, 6),
  "created_at"            TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "seller_wallet_entries_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "seller_wallet_entries_seller_id_currency_created_at_idx"
  ON "seller_wallet_entries" ("seller_id", "currency", "created_at");
CREATE INDEX "seller_wallet_entries_linked_order_id_idx"
  ON "seller_wallet_entries" ("linked_order_id");
CREATE INDEX "seller_wallet_entries_linked_remittance_id_idx"
  ON "seller_wallet_entries" ("linked_remittance_id");
CREATE INDEX "seller_wallet_entries_linked_entry_id_idx"
  ON "seller_wallet_entries" ("linked_entry_id");

-- ── seller_wallet_balances — the cache (recomputed post-commit) ───────
CREATE TABLE "seller_wallet_balances" (
  "id"            UUID NOT NULL DEFAULT uuidv7(),
  "seller_id"     UUID NOT NULL,
  "currency"      "currency" NOT NULL,
  "balance"       DECIMAL(14, 2) NOT NULL DEFAULT 0,
  "last_entry_id" UUID,
  "updated_at"    TIMESTAMPTZ NOT NULL,

  CONSTRAINT "seller_wallet_balances_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "seller_wallet_balances_seller_id_currency_key"
  ON "seller_wallet_balances" ("seller_id", "currency");
CREATE INDEX "seller_wallet_balances_seller_id_idx"
  ON "seller_wallet_balances" ("seller_id");

-- ── remittances — admin-recorded payouts ──────────────────────────────
CREATE TABLE "remittances" (
  "id"                     UUID NOT NULL DEFAULT uuidv7(),
  "seller_id"              UUID NOT NULL,
  "currency"               "currency" NOT NULL,
  "amount"                 DECIMAL(14, 2) NOT NULL,
  "source_currency"        "currency" NOT NULL,
  "source_amount"          DECIMAL(14, 2) NOT NULL,
  "fx_rate_snapshot"       DECIMAL(18, 6) NOT NULL,
  "bank_account_snapshot"  JSONB NOT NULL,
  "bank_reference"         TEXT NOT NULL,
  "paid_at"                TIMESTAMPTZ NOT NULL,
  "staff_id"               UUID NOT NULL,
  "note"                   TEXT,
  "created_at"             TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "remittances_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "remittances_seller_id_paid_at_idx"
  ON "remittances" ("seller_id", "paid_at");
CREATE INDEX "remittances_paid_at_idx"
  ON "remittances" ("paid_at");
CREATE INDEX "remittances_staff_id_idx"
  ON "remittances" ("staff_id");

-- ── FKs ───────────────────────────────────────────────────────────────
ALTER TABLE "seller_wallet_entries"
  ADD CONSTRAINT "seller_wallet_entries_seller_id_fkey"
    FOREIGN KEY ("seller_id") REFERENCES "sellers"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "seller_wallet_entries"
  ADD CONSTRAINT "seller_wallet_entries_linked_order_id_fkey"
    FOREIGN KEY ("linked_order_id") REFERENCES "orders"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "seller_wallet_entries"
  ADD CONSTRAINT "seller_wallet_entries_linked_entry_id_fkey"
    FOREIGN KEY ("linked_entry_id") REFERENCES "seller_wallet_entries"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "seller_wallet_entries"
  ADD CONSTRAINT "seller_wallet_entries_linked_remittance_id_fkey"
    FOREIGN KEY ("linked_remittance_id") REFERENCES "remittances"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "seller_wallet_balances"
  ADD CONSTRAINT "seller_wallet_balances_seller_id_fkey"
    FOREIGN KEY ("seller_id") REFERENCES "sellers"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "remittances"
  ADD CONSTRAINT "remittances_seller_id_fkey"
    FOREIGN KEY ("seller_id") REFERENCES "sellers"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "remittances"
  ADD CONSTRAINT "remittances_staff_id_fkey"
    FOREIGN KEY ("staff_id") REFERENCES "staff_users"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
