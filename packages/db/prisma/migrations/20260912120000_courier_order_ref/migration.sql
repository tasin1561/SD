-- A Shiprocket charge's ORDER id, lifted out of `detail` — where every
-- passbook row has kept it since COST-2 — so a parcel's charges follow
-- it across a waybill Shiprocket reassigns. Shiprocket accounts only:
-- Delhivery has one waybill per parcel and no order id to key on.
ALTER TABLE "courier_wallet_transactions" ADD COLUMN "courier_order_ref" TEXT;

UPDATE "courier_wallet_transactions" t
SET "courier_order_ref" = t."detail"->>'orderId'
FROM "courier_accounts" a
JOIN "couriers" c ON c."id" = a."courier_id"
WHERE a."id" = t."courier_account_id"
  AND c."code" = 'shiprocket'
  AND t."detail" ? 'orderId'
  AND NULLIF(t."detail"->>'orderId', '') IS NOT NULL;

CREATE INDEX "cwt_account_order_ref_idx" ON "courier_wallet_transactions"("courier_account_id", "courier_order_ref");
