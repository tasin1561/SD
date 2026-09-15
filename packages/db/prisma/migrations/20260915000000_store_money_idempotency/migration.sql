-- IDEM-1 for a reseller store's own money forms (UI audit, 2026-09-15).
-- The top-up claim and the withdrawal request each carry the key their
-- form minted when it opened; a retry with the same key and the same
-- request answers with the row already written instead of a second one.
ALTER TABLE "store_topup_requests" ADD COLUMN "idempotency_key" UUID;
ALTER TABLE "store_withdrawal_requests" ADD COLUMN "idempotency_key" UUID;

CREATE UNIQUE INDEX "store_topup_requests_idempotency_key_key" ON "store_topup_requests"("idempotency_key");
CREATE UNIQUE INDEX "store_withdrawal_requests_idempotency_key_key" ON "store_withdrawal_requests"("idempotency_key");
