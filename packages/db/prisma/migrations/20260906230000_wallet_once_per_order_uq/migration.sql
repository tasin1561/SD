-- Nine wallet directions may happen exactly ONCE per order. Until now
-- nothing said so to the database: each path guarded itself by reading
-- the ledger and writing if it found nothing, which under READ COMMITTED
-- lets two concurrent transactions both find nothing and both write.
--
-- The advisory lock (WAL-7, added alongside this) prevents it. This makes
-- it UNREPRESENTABLE — the same belt-and-braces as the pack-box claims
-- and the notification dedup, and the layer that still holds if a future
-- caller forgets the lock.
--
-- PARTIAL, and every exclusion is deliberate:
--   SCRAP_REFUND      an order may carry several tickets, each refundable
--   ADJUSTMENT_*      an operator may correct the same order more than once
--   TOPUP, OPENING_BALANCE, REMITTANCE_*  are not order-linked at all
--
-- Prisma cannot express a partial unique, so this is migration-only and
-- documented on the model — the same shape as
-- courier_pickup_requests_open_day_uq and call_queue_entries_open_order_uq.
CREATE UNIQUE INDEX "seller_wallet_entries_once_per_order_uq"
  ON "seller_wallet_entries" ("linked_order_id", "direction")
  WHERE "linked_order_id" IS NOT NULL
    AND "direction" IN (
      'cod_collection',
      'cod_collection_fee',
      'customer_return_fee',
      'gst_withholding',
      'inbound_freight',
      'instant_pay_fee',
      'order_charges',
      'order_charges_refund',
      'rto_fee'
    );
