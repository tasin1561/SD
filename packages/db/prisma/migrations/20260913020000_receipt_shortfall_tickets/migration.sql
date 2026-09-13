-- TKT-3 (2026-09-13): a goods receipt that comes up short opens a ticket.
--
-- A new ticket type, and the receipt it is about. Nothing existing is
-- touched: every current ticket keeps goods_receipt_id NULL, and NULLs
-- are distinct in the unique index, so they stay unconstrained by it.
--
-- The one production shortfall that predates this (GR-2026-08-0004) is
-- ticketed by the operator-run backfill
-- (POST /admin/goods-receipts/shortfall-tickets/backfill), deliberately
-- NOT here: opening a ticket also tells the seller, and a migration is
-- the wrong place to send a message.

-- ADD VALUE runs inside the migration's transaction (Postgres >= 12). The
-- value is not USED in this transaction, which is the only restriction.
ALTER TYPE "ticket_type" ADD VALUE IF NOT EXISTS 'receipt_shortfall';

ALTER TABLE "tickets" ADD COLUMN "goods_receipt_id" UUID;

CREATE UNIQUE INDEX "tickets_goods_receipt_id_ticket_type_key"
  ON "tickets" ("goods_receipt_id", "ticket_type");

ALTER TABLE "tickets"
  ADD CONSTRAINT "tickets_goods_receipt_id_fkey"
    FOREIGN KEY ("goods_receipt_id") REFERENCES "goods_receipts"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
