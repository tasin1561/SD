-- RS-6 (2026-09-14) — reseller store wallets. docs/reseller-stores.md
-- "Store wallet as built".
--
-- Decision 7: our bank book knows ONLY the seller. A store wallet is a
-- ledger between a seller and one of their reseller stores, and every rupee
-- behind it is the SELLER's in bank_entries — so this migration adds no
-- owner kind to the bank book. The TRE-8 invariant becomes
--   held for a seller = max(0, seller wallet + Σ that seller's store wallets)
-- and is kept by the service layer (SellerCashAttributionService).

-- CreateEnum
CREATE TYPE "store_wallet_entry_direction" AS ENUM ('seller_topup', 'seller_payout', 'topup', 'withdrawal', 'order_credit', 'order_credit_reversal', 'fee_share', 'cod_tax_share', 'share_refund', 'prepaid_debit', 'prepaid_refund');

-- AlterEnum — the seller-side twins of a SELLER-managed top-up and a
-- recorded payout. Neither is used by this migration, so adding them inside
-- the migration's transaction is safe.
ALTER TYPE "wallet_entry_direction" ADD VALUE 'store_topup_out';
ALTER TYPE "wallet_entry_direction" ADD VALUE 'store_payout_in';

-- CreateTable
CREATE TABLE "store_wallet_entries" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "store_id" UUID NOT NULL,
    "seller_id" UUID NOT NULL,
    "direction" "store_wallet_entry_direction" NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "running_balance_after" DECIMAL(14,2) NOT NULL,
    "share_of" "wallet_entry_direction",
    "linked_order_id" UUID,
    "linked_entry_id" UUID,
    "linked_seller_entry_id" UUID,
    "reason_code" TEXT,
    "note" TEXT,
    "actor_type" "actor_type" NOT NULL,
    "actor_id" UUID,
    "idempotency_key" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "store_wallet_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "store_topup_requests" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "store_id" UUID NOT NULL,
    "seller_id" UUID NOT NULL,
    "bank_account_id" UUID NOT NULL,
    "amount_inr" DECIMAL(14,2) NOT NULL,
    "transaction_ref" TEXT,
    "proof_spaces_key" TEXT,
    "proof_mime_type" TEXT,
    "status" "topup_request_status" NOT NULL DEFAULT 'pending',
    "store_entry_id" UUID,
    "submitted_by_store_user_id" UUID,
    "reviewed_by_staff_id" UUID,
    "reviewed_at" TIMESTAMPTZ,
    "review_note" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "store_topup_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "store_withdrawal_requests" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "store_id" UUID NOT NULL,
    "seller_id" UUID NOT NULL,
    "amount_inr" DECIMAL(14,2) NOT NULL,
    "status" "withdrawal_request_status" NOT NULL DEFAULT 'pending',
    "payee_name" TEXT NOT NULL,
    "payee_account_number" TEXT NOT NULL,
    "payee_ifsc" TEXT NOT NULL,
    "payee_bank_name" TEXT NOT NULL,
    "note" TEXT,
    "requested_by_store_user_id" UUID,
    "resolved_by_staff_id" UUID,
    "resolved_at" TIMESTAMPTZ,
    "rejection_reason" TEXT,
    "paid_from_account_id" UUID,
    "bank_reference" TEXT,
    "paid_at" TIMESTAMPTZ,
    "store_entry_id" UUID,
    "payout_idempotency_key" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "store_withdrawal_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "store_wallet_settings" (
    "store_id" UUID NOT NULL,
    "negative_limit_inr" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "updated_by_seller_user_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "store_wallet_settings_pkey" PRIMARY KEY ("store_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "store_wallet_entries_linked_seller_entry_id_key" ON "store_wallet_entries"("linked_seller_entry_id");

-- CreateIndex
CREATE UNIQUE INDEX "store_wallet_entries_idempotency_key_key" ON "store_wallet_entries"("idempotency_key");

-- CreateIndex
CREATE INDEX "store_wallet_entries_store_id_id_idx" ON "store_wallet_entries"("store_id", "id");

-- CreateIndex
CREATE INDEX "store_wallet_entries_seller_id_id_idx" ON "store_wallet_entries"("seller_id", "id");

-- CreateIndex
CREATE INDEX "store_wallet_entries_linked_order_id_idx" ON "store_wallet_entries"("linked_order_id");

-- CreateIndex
CREATE INDEX "store_wallet_entries_linked_entry_id_idx" ON "store_wallet_entries"("linked_entry_id");

-- CreateIndex
CREATE UNIQUE INDEX "store_topup_requests_store_entry_id_key" ON "store_topup_requests"("store_entry_id");

-- CreateIndex
CREATE INDEX "store_topup_requests_store_id_status_idx" ON "store_topup_requests"("store_id", "status");

-- CreateIndex
CREATE INDEX "store_topup_requests_status_created_at_idx" ON "store_topup_requests"("status", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "store_withdrawal_requests_store_entry_id_key" ON "store_withdrawal_requests"("store_entry_id");

-- CreateIndex
CREATE UNIQUE INDEX "store_withdrawal_requests_payout_idempotency_key_key" ON "store_withdrawal_requests"("payout_idempotency_key");

-- CreateIndex
CREATE INDEX "store_withdrawal_requests_store_id_status_idx" ON "store_withdrawal_requests"("store_id", "status");

-- CreateIndex
CREATE INDEX "store_withdrawal_requests_status_created_at_idx" ON "store_withdrawal_requests"("status", "created_at");

-- AddForeignKey
ALTER TABLE "store_wallet_entries" ADD CONSTRAINT "store_wallet_entries_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "seller_stores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "store_wallet_entries" ADD CONSTRAINT "store_wallet_entries_linked_entry_id_fkey" FOREIGN KEY ("linked_entry_id") REFERENCES "store_wallet_entries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "store_topup_requests" ADD CONSTRAINT "store_topup_requests_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "seller_stores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "store_topup_requests" ADD CONSTRAINT "store_topup_requests_bank_account_id_fkey" FOREIGN KEY ("bank_account_id") REFERENCES "platform_bank_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "store_topup_requests" ADD CONSTRAINT "store_topup_requests_store_entry_id_fkey" FOREIGN KEY ("store_entry_id") REFERENCES "store_wallet_entries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "store_withdrawal_requests" ADD CONSTRAINT "store_withdrawal_requests_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "seller_stores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "store_withdrawal_requests" ADD CONSTRAINT "store_withdrawal_requests_paid_from_account_id_fkey" FOREIGN KEY ("paid_from_account_id") REFERENCES "platform_bank_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "store_withdrawal_requests" ADD CONSTRAINT "store_withdrawal_requests_store_entry_id_fkey" FOREIGN KEY ("store_entry_id") REFERENCES "store_wallet_entries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "store_wallet_settings" ADD CONSTRAINT "store_wallet_settings_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "seller_stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ── What Prisma cannot express ──────────────────────────────────────────
-- An entry's amount is always positive (its direction carries the sign), a
-- request is for a positive amount, and a negative limit is a distance
-- below zero, never a negative number. CHECKs rather than service checks
-- alone: the service refuses first, the database is what still holds when a
-- future writer forgets.
ALTER TABLE "store_wallet_entries" ADD CONSTRAINT "store_wallet_entries_amount_positive_ck" CHECK ("amount" > 0);
ALTER TABLE "store_topup_requests" ADD CONSTRAINT "store_topup_requests_amount_positive_ck" CHECK ("amount_inr" > 0);
ALTER TABLE "store_withdrawal_requests" ADD CONSTRAINT "store_withdrawal_requests_amount_positive_ck" CHECK ("amount_inr" > 0);
ALTER TABLE "store_wallet_settings" ADD CONSTRAINT "store_wallet_settings_negative_limit_ck" CHECK ("negative_limit_inr" >= 0);

-- ── The cap Skydrop puts on a store's negative limit (SET-1) ────────────
-- seedSystemSettings() is create-only on value columns and deploy runs
-- migrations, not the seed, so the row is inserted here. ON CONFLICT DO
-- NOTHING: a row the seed already made (dev, CI) keeps what it holds.
INSERT INTO "system_settings" (
  "id", "key", "category", "value_type", "value_decimal",
  "display_name", "description",
  "is_editable_by_admin", "is_sensitive", "seller_overridable",
  "override_min_decimal", "override_max_decimal",
  "created_at", "updated_at"
)
VALUES (
  uuidv7(),
  'reseller.store_negative_limit_cap_inr',
  'wallet',
  'decimal',
  25000.00,
  'Reseller stores: the most a seller may let one store go below zero (INR)',
  'A seller decides how far below zero each of their reseller stores may go — their risk, since a store''s negative balance is money the seller is owed by that store. This caps that choice: whatever the seller sets, a store is never allowed further below zero than this. Per-seller override, for a seller we know and want to allow more (or less). Order create refuses an order that would take a store past the lower of the two.',
  true,
  false,
  true,
  0,
  10000000
)
ON CONFLICT ("key") DO NOTHING;

-- ── The store roles that already exist get the wallet permissions ────────
-- Every store was provisioned with five roles (RS-2). The OWNER holds every
-- key implicitly; ADMIN and FINANCE are given the three wallet keys here,
-- exactly as a store created from now on gets them from the code
-- (DEFAULT_STORE_ROLES). OPS and VIEWER are left without: money is not
-- day-to-day work.
INSERT INTO "store_role_permissions" ("role_id", "permission")
SELECT r."id", p."permission"
FROM "store_roles" r
CROSS JOIN (
  VALUES ('wallet.view'), ('wallet.topups.manage'), ('wallet.withdrawals.manage')
) AS p("permission")
WHERE r."key" IN ('admin', 'finance')
ON CONFLICT ("role_id", "permission") DO NOTHING;
