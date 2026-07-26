-- R2b (revised-plan roadmap) — T_PLUS_N wallet-timing tier scheduling.
--
-- Additive only. pending_accruals is a scheduling record, not a ledger
-- — the wallet ledger is untouched by this migration; PendingAccrualSweepService
-- calls the exact same AccrualExecutionService.executeAccrual() the
-- INSTANT (default) tier already calls immediately.

CREATE TABLE "pending_accruals" (
  "id"           UUID NOT NULL DEFAULT uuidv7(),
  "order_id"     UUID NOT NULL,
  "seller_id"    UUID NOT NULL,
  "eligible_at"  TIMESTAMPTZ NOT NULL,
  "processed_at" TIMESTAMPTZ,
  "created_at"   TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "pending_accruals_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "pending_accruals_order_id_key"
  ON "pending_accruals" ("order_id");
CREATE INDEX "pending_accruals_eligible_at_processed_at_idx"
  ON "pending_accruals" ("eligible_at", "processed_at");
CREATE INDEX "pending_accruals_seller_id_idx"
  ON "pending_accruals" ("seller_id");

ALTER TABLE "pending_accruals"
  ADD CONSTRAINT "pending_accruals_order_id_fkey"
    FOREIGN KEY ("order_id") REFERENCES "orders"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "pending_accruals"
  ADD CONSTRAINT "pending_accruals_seller_id_fkey"
    FOREIGN KEY ("seller_id") REFERENCES "sellers"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
