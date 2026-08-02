-- The COD credit model: who gets paid when, and what we withhold.

-- The fee for being credited at delivery rather than waiting for the
-- courier. Always a DEBIT, so deliberately absent from
-- WalletService.CREDIT_DIRECTIONS (WAL-1). Its own value rather than
-- folded into ORDER_CHARGES, so revenue from the service is countable.
ALTER TYPE "wallet_entry_direction" ADD VALUE IF NOT EXISTS 'instant_pay_fee';

-- One at a time, by construction. An enum rather than two booleans
-- makes "only one enabled" unrepresentable instead of validated.
CREATE TYPE "cod_credit_mode" AS ENUM ('settlement', 'instant_pay');

-- GST withheld from a seller's COD proceeds, which WE file.
--
-- This is NOT margin and must never read as revenue. The customer paid a
-- tax-inclusive price; we hold the tax portion between collecting it and
-- filing it. Without a record of its own it lands in the same pot as
-- everything else and gets spent before the return is due.
CREATE TABLE "gst_withholdings" (
  "id"                UUID          NOT NULL DEFAULT uuidv7(),
  "seller_id"         UUID          NOT NULL,
  -- UNIQUE: one withholding per order, which is also what stops a
  -- re-credit withholding twice.
  "order_id"          UUID          NOT NULL,
  "cod_amount_inr"    DECIMAL(12,2) NOT NULL,
  -- Snapshotted. A later rate change must not silently restate what we
  -- withheld last quarter.
  "gst_percent"       DECIMAL(5,2)  NOT NULL,
  -- Extracted from the inclusive price (cod × r / (100 + r)), never
  -- added on top of it.
  "gst_amount_inr"    DECIMAL(12,2) NOT NULL,
  "net_to_seller_inr" DECIMAL(12,2) NOT NULL,
  "withheld_at"       TIMESTAMPTZ   NOT NULL DEFAULT CURRENT_TIMESTAMP,
  -- Null ⇒ still owed to the department.
  "filed_at"          TIMESTAMPTZ,
  "filing_ref"        TEXT,
  CONSTRAINT "gst_withholdings_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "gst_withholdings_order_id_key" ON "gst_withholdings" ("order_id");
CREATE INDEX "gst_withholdings_seller_id_withheld_at_idx"
  ON "gst_withholdings" ("seller_id", "withheld_at");
CREATE INDEX "gst_withholdings_filed_at_idx" ON "gst_withholdings" ("filed_at");

ALTER TABLE "gst_withholdings"
  ADD CONSTRAINT "gst_withholdings_seller_id_fkey"
  FOREIGN KEY ("seller_id") REFERENCES "sellers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "gst_withholdings"
  ADD CONSTRAINT "gst_withholdings_order_id_fkey"
  FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
