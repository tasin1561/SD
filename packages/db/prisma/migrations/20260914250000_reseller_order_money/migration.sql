-- RS-6 phase 3c + RS-7 (2026-09-14) — the MONEY of a reseller store's
-- orders, and store ↔ seller disputes. docs/reseller-stores.md "Order
-- money as built" and "RS-7 as built".
--
-- Adds wallet directions (seller and store), a ticket type, and ONE table:
-- `reseller_order_credits`, the per-party credit plan of a reseller order
-- and where it stands. No row is backfilled: `reseller.orders_enabled` has
-- been OFF everywhere since RS-5, so no reseller order exists to plan.

-- AlterEnum — none of these values is used by this migration, so adding
-- them inside its transaction is safe.
ALTER TYPE "wallet_entry_direction" ADD VALUE 'reseller_transfer_credit';
ALTER TYPE "wallet_entry_direction" ADD VALUE 'reseller_transfer_reversal';
ALTER TYPE "wallet_entry_direction" ADD VALUE 'prepaid_transfer_credit';
ALTER TYPE "wallet_entry_direction" ADD VALUE 'prepaid_transfer_reversal';
ALTER TYPE "wallet_entry_direction" ADD VALUE 'store_dispute_in';
ALTER TYPE "wallet_entry_direction" ADD VALUE 'store_dispute_out';

ALTER TYPE "store_wallet_entry_direction" ADD VALUE 'transfer_price';
ALTER TYPE "store_wallet_entry_direction" ADD VALUE 'transfer_price_refund';
ALTER TYPE "store_wallet_entry_direction" ADD VALUE 'dispute_settlement_in';
ALTER TYPE "store_wallet_entry_direction" ADD VALUE 'dispute_settlement_out';

ALTER TYPE "ticket_type" ADD VALUE 'store_dispute';

-- CreateEnum
CREATE TYPE "reseller_money_party" AS ENUM ('store', 'seller');

-- CreateEnum
CREATE TYPE "reseller_credit_status" AS ENUM ('waiting', 'due', 'credited', 'reversed', 'skipped');

-- CreateTable
CREATE TABLE "reseller_order_credits" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "order_id" UUID NOT NULL,
    "seller_id" UUID NOT NULL,
    "store_id" UUID NOT NULL,
    "party" "reseller_money_party" NOT NULL,
    "trigger" "reseller_credit_trigger" NOT NULL,
    "days" INTEGER NOT NULL,
    "status" "reseller_credit_status" NOT NULL DEFAULT 'waiting',
    "due_at" TIMESTAMPTZ,
    "credited_at" TIMESTAMPTZ,
    "reversed_at" TIMESTAMPTZ,
    "skipped_reason" TEXT,
    "gross_inr" DECIMAL(14,2) NOT NULL,
    "transfer_inr" DECIMAL(14,2) NOT NULL,
    "tax_share_inr" DECIMAL(14,2) NOT NULL,
    "cod_fee_share_inr" DECIMAL(14,2) NOT NULL,
    "instant_fee_share_inr" DECIMAL(14,2) NOT NULL,
    "net_inr" DECIMAL(14,2) NOT NULL,
    "times_credited" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "reseller_order_credits_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "reseller_order_credits_order_id_party_key" ON "reseller_order_credits"("order_id", "party");

-- CreateIndex
CREATE INDEX "reseller_order_credits_status_due_at_idx" ON "reseller_order_credits"("status", "due_at");

-- CreateIndex
CREATE INDEX "reseller_order_credits_store_id_idx" ON "reseller_order_credits"("store_id");

-- CreateIndex
CREATE INDEX "reseller_order_credits_seller_id_idx" ON "reseller_order_credits"("seller_id");

-- AddForeignKey
ALTER TABLE "reseller_order_credits" ADD CONSTRAINT "reseller_order_credits_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reseller_order_credits" ADD CONSTRAINT "reseller_order_credits_seller_id_fkey" FOREIGN KEY ("seller_id") REFERENCES "sellers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reseller_order_credits" ADD CONSTRAINT "reseller_order_credits_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "seller_stores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- The figures a credit carries: never negative, except `net` (a store may
-- sell below the transfer price, and then owes the difference), and net is
-- exactly what the other columns say it is.
ALTER TABLE "reseller_order_credits" ADD CONSTRAINT "reseller_order_credits_figures_ck" CHECK (
  "gross_inr" >= 0 AND "transfer_inr" >= 0 AND "tax_share_inr" >= 0
  AND "cod_fee_share_inr" >= 0 AND "instant_fee_share_inr" >= 0
  AND "net_inr" = "gross_inr" - "transfer_inr" - "tax_share_inr" - "cod_fee_share_inr" - "instant_fee_share_inr"
  AND "days" >= 0 AND "days" <= 365 AND "times_credited" >= 0
);
-- A seller never pays a transfer price to itself.
ALTER TABLE "reseller_order_credits" ADD CONSTRAINT "reseller_order_credits_seller_transfer_ck" CHECK (
  "party" <> 'seller' OR "transfer_inr" = 0
);
-- DUE carries its time; CREDITED carries when.
ALTER TABLE "reseller_order_credits" ADD CONSTRAINT "reseller_order_credits_status_ck" CHECK (
  ("status" <> 'due' OR "due_at" IS NOT NULL)
  AND ("status" <> 'credited' OR "credited_at" IS NOT NULL)
);

-- ── RS-7 — store ↔ seller disputes on tickets ──────────────────────────
-- AlterTable
ALTER TABLE "tickets" ADD COLUMN "store_id" UUID,
ADD COLUMN "opened_by_store_user_id" UUID,
ADD COLUMN "dispute_payer" "reseller_money_party",
ADD COLUMN "resolution_store_entry_id" UUID;

-- CreateIndex
CREATE UNIQUE INDEX "tickets_resolution_store_entry_id_key" ON "tickets"("resolution_store_entry_id");

-- CreateIndex
CREATE INDEX "tickets_store_id_idx" ON "tickets"("store_id");

-- AddForeignKey
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "seller_stores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_opened_by_store_user_id_fkey" FOREIGN KEY ("opened_by_store_user_id") REFERENCES "store_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ── RS-7 — the store's ticket permissions, for EXISTING stores ──────────
-- New stores get them from provisionDefaultStoreRoles; the owner holds
-- every permission implicitly.
INSERT INTO "store_role_permissions" ("id", "role_id", "permission", "granted_at")
SELECT uuidv7(), r."id", p."permission", CURRENT_TIMESTAMP
FROM "store_roles" r
JOIN (
  VALUES
    ('admin', 'tickets.view'),
    ('admin', 'tickets.manage'),
    ('ops', 'tickets.view'),
    ('ops', 'tickets.manage'),
    ('finance', 'tickets.view'),
    ('viewer', 'tickets.view')
) AS p("role_key", "permission") ON p."role_key" = r."key"
WHERE r."is_system" = true AND r."deleted_at" IS NULL
ON CONFLICT ("role_id", "permission") DO NOTHING;
