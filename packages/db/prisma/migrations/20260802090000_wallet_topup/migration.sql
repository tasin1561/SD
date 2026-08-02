-- Wallet top-up: the inbound money path.
--
-- Until now the wallet had a credit side only for sellers shipping COD.
-- A prepaid-only seller accrued nothing but debits — delivery fees,
-- freight, returns — and had no way to settle them, so their balance
-- went negative and stayed there. This is how money gets in.

ALTER TYPE "wallet_entry_direction" ADD VALUE IF NOT EXISTS 'topup';

CREATE TYPE "topup_request_status" AS ENUM ('pending', 'accepted', 'rejected');

-- One of OUR accounts, published to sellers on purpose. The number is
-- NOT encrypted, unlike a seller's: encrypting a value we display on a
-- screen would be theatre.
CREATE TABLE "platform_bank_accounts" (
  "id"             UUID        NOT NULL DEFAULT uuidv7(),
  "label"          TEXT        NOT NULL,
  "bank_name"      TEXT        NOT NULL,
  "account_name"   TEXT        NOT NULL,
  "account_number" TEXT        NOT NULL,
  "branch_code"    TEXT,
  "currency"       "currency"  NOT NULL,
  "instructions"   TEXT,
  "is_active"      BOOLEAN     NOT NULL DEFAULT true,
  "display_order"  INTEGER     NOT NULL DEFAULT 100,
  "created_at"     TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"     TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deleted_at"     TIMESTAMPTZ,
  CONSTRAINT "platform_bank_accounts_pkey" PRIMARY KEY ("id")
);

-- A seller CLAIMS they sent money; an operator checks the bank.
--
-- The wallet is not credited on submission. Crediting first and clawing
-- back on rejection would let anyone raise their balance by filling in a
-- form, and the claw-back would land after they had withdrawn against it.
CREATE TABLE "wallet_topup_requests" (
  "id"                   UUID                   NOT NULL DEFAULT uuidv7(),
  "seller_id"            UUID                   NOT NULL,
  "bank_account_id"      UUID                   NOT NULL,
  "currency"             "currency"             NOT NULL,
  "amount"               DECIMAL(14,2)          NOT NULL,
  "transaction_ref"      TEXT,
  -- Spaces KEY, never a URL: reads are presigned on demand.
  "proof_spaces_key"     TEXT,
  "proof_mime_type"      TEXT,
  "status"               "topup_request_status" NOT NULL DEFAULT 'pending',
  -- UNIQUE, so a second accept cannot mint a second credit.
  "wallet_entry_id"      UUID,
  "submitted_by_user_id" UUID,
  "reviewed_by_staff_id" UUID,
  "reviewed_at"          TIMESTAMPTZ,
  "review_note"          TEXT,
  "created_at"           TIMESTAMPTZ            NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"           TIMESTAMPTZ            NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "wallet_topup_requests_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "platform_bank_accounts_is_active_display_order_idx"
  ON "platform_bank_accounts" ("is_active", "display_order");
CREATE UNIQUE INDEX "wallet_topup_requests_wallet_entry_id_key"
  ON "wallet_topup_requests" ("wallet_entry_id");
CREATE INDEX "wallet_topup_requests_seller_id_status_idx"
  ON "wallet_topup_requests" ("seller_id", "status");
CREATE INDEX "wallet_topup_requests_status_created_at_idx"
  ON "wallet_topup_requests" ("status", "created_at");

ALTER TABLE "wallet_topup_requests"
  ADD CONSTRAINT "wallet_topup_requests_seller_id_fkey"
  FOREIGN KEY ("seller_id") REFERENCES "sellers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "wallet_topup_requests"
  ADD CONSTRAINT "wallet_topup_requests_bank_account_id_fkey"
  FOREIGN KEY ("bank_account_id") REFERENCES "platform_bank_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "wallet_topup_requests"
  ADD CONSTRAINT "wallet_topup_requests_submitted_by_user_id_fkey"
  FOREIGN KEY ("submitted_by_user_id") REFERENCES "seller_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "wallet_topup_requests"
  ADD CONSTRAINT "wallet_topup_requests_reviewed_by_staff_id_fkey"
  FOREIGN KEY ("reviewed_by_staff_id") REFERENCES "staff_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "wallet_topup_requests"
  ADD CONSTRAINT "wallet_topup_requests_wallet_entry_id_fkey"
  FOREIGN KEY ("wallet_entry_id") REFERENCES "seller_wallet_entries"("id") ON DELETE SET NULL ON UPDATE CASCADE;
