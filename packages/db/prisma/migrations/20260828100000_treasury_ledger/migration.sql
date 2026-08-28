-- Treasury: our own money, and whose it is.
--
-- The seller wallet says what we OWE. These tables say what we HOLD and
-- where. Balances are summed from entries rather than cached: the wallet
-- cache taught us that a number refreshed by whoever remembers is a
-- number that is eventually wrong, and money read wrong is worse than
-- money read slowly.

CREATE TYPE "bank_owner_kind" AS ENUM ('seller', 'capital');

CREATE TYPE "bank_entry_type" AS ENUM (
  'opening_balance',
  'courier_settlement',
  'seller_topup',
  'seller_withdrawal',
  'transfer_in',
  'transfer_out',
  'expense',
  'investment_out',
  'investment_return',
  'fx_spread',
  'reconciliation_adjustment'
);

CREATE TABLE "expense_categories" (
  "id"         UUID PRIMARY KEY DEFAULT uuidv7(),
  "code"       TEXT NOT NULL,
  "name"       TEXT NOT NULL,
  "hint"       TEXT,
  "is_active"  BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updated_at" TIMESTAMPTZ NOT NULL,
  "deleted_at" TIMESTAMPTZ
);
CREATE UNIQUE INDEX "expense_categories_code_key" ON "expense_categories" ("code");
CREATE INDEX "expense_categories_is_active_idx" ON "expense_categories" ("is_active");

CREATE TABLE "investments" (
  "id"           UUID PRIMARY KEY DEFAULT uuidv7(),
  "label"        TEXT NOT NULL,
  "counterparty" TEXT NOT NULL,
  "currency"     "currency" NOT NULL,
  "placed_inr"   DECIMAL(14,2) NOT NULL DEFAULT 0,
  "returned_inr" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "closed_at"    TIMESTAMPTZ,
  "note"         TEXT,
  "created_at"   TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updated_at"   TIMESTAMPTZ NOT NULL
);

-- What this account is for, and which courier pipe fills it.
ALTER TABLE "platform_bank_accounts"
  ADD COLUMN "purpose" TEXT,
  ADD COLUMN "courier_account_id" UUID;
ALTER TABLE "platform_bank_accounts"
  ADD CONSTRAINT "platform_bank_accounts_courier_account_id_fkey"
  FOREIGN KEY ("courier_account_id") REFERENCES "courier_accounts"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "platform_bank_accounts_courier_account_id_idx"
  ON "platform_bank_accounts" ("courier_account_id");

-- BOTH amounts on a cross-currency move: the rate changes hour to hour,
-- so storing a rate instead of the received figure means the book
-- disagrees with the statement.
CREATE TABLE "bank_transfers" (
  "id"                  UUID PRIMARY KEY DEFAULT uuidv7(),
  "from_account_id"     UUID NOT NULL,
  "to_account_id"       UUID NOT NULL,
  "amount_out"          DECIMAL(14,2) NOT NULL,
  "currency_out"        "currency" NOT NULL,
  "amount_in"           DECIMAL(14,2) NOT NULL,
  "currency_in"         "currency" NOT NULL,
  "quoted_rate"         DECIMAL(18,6),
  "achieved_rate"       DECIMAL(18,6),
  "seller_id"           UUID,
  "reference"           TEXT,
  "note"                TEXT,
  "moved_at"            TIMESTAMPTZ NOT NULL,
  "created_by_staff_id" UUID,
  "created_at"          TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT "bank_transfers_from_account_id_fkey" FOREIGN KEY ("from_account_id") REFERENCES "platform_bank_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "bank_transfers_to_account_id_fkey"   FOREIGN KEY ("to_account_id")   REFERENCES "platform_bank_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "bank_transfers_seller_id_fkey"       FOREIGN KEY ("seller_id")       REFERENCES "sellers"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "bank_transfers_created_by_staff_id_fkey" FOREIGN KEY ("created_by_staff_id") REFERENCES "staff_users"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE INDEX "bank_transfers_from_account_id_idx" ON "bank_transfers" ("from_account_id");
CREATE INDEX "bank_transfers_to_account_id_idx"   ON "bank_transfers" ("to_account_id");
CREATE INDEX "bank_transfers_seller_id_idx"       ON "bank_transfers" ("seller_id");
CREATE INDEX "bank_transfers_moved_at_idx"        ON "bank_transfers" ("moved_at");

-- Append-only. signed_amount carries its own direction so a balance is a
-- SUM, and a sum cannot disagree with itself the way a debit/credit pair
-- plus a direction flag can.
CREATE TABLE "bank_entries" (
  "id"                    UUID PRIMARY KEY DEFAULT uuidv7(),
  "account_id"            UUID NOT NULL,
  "type"                  "bank_entry_type" NOT NULL,
  "signed_amount"         DECIMAL(14,2) NOT NULL,
  "currency"              "currency" NOT NULL,
  "owner_kind"            "bank_owner_kind" NOT NULL,
  "seller_id"             UUID,
  "transfer_id"           UUID,
  "expense_category_id"   UUID,
  "investment_id"         UUID,
  "settlement_id"         UUID,
  "topup_request_id"      UUID,
  "withdrawal_request_id" UUID,
  "reference"             TEXT,
  "note"                  TEXT,
  "occurred_at"           TIMESTAMPTZ NOT NULL,
  "created_by_staff_id"   UUID,
  "created_at"            TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT "bank_entries_account_id_fkey"          FOREIGN KEY ("account_id")          REFERENCES "platform_bank_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "bank_entries_seller_id_fkey"           FOREIGN KEY ("seller_id")           REFERENCES "sellers"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "bank_entries_transfer_id_fkey"         FOREIGN KEY ("transfer_id")         REFERENCES "bank_transfers"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "bank_entries_expense_category_id_fkey" FOREIGN KEY ("expense_category_id") REFERENCES "expense_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "bank_entries_investment_id_fkey"       FOREIGN KEY ("investment_id")       REFERENCES "investments"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "bank_entries_created_by_staff_id_fkey" FOREIGN KEY ("created_by_staff_id") REFERENCES "staff_users"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE INDEX "bank_entries_account_id_occurred_at_idx" ON "bank_entries" ("account_id", "occurred_at");
CREATE INDEX "bank_entries_account_id_owner_kind_seller_id_idx" ON "bank_entries" ("account_id", "owner_kind", "seller_id");
CREATE INDEX "bank_entries_seller_id_idx"   ON "bank_entries" ("seller_id");
CREATE INDEX "bank_entries_type_idx"        ON "bank_entries" ("type");
CREATE INDEX "bank_entries_transfer_id_idx" ON "bank_entries" ("transfer_id");
