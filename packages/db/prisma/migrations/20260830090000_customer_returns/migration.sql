-- Customer-initiated returns.
--
-- Distinct from RTO, which is the courier bringing back a parcel it
-- could not deliver. This starts from DELIVERED: the customer has the
-- goods and wants to send them back, so it is a SECOND delivery and is
-- priced like one (₹200), where an RTO is a failed first attempt and
-- carries a smaller fee (₹30).
--
-- The goods travel the existing RTO path home — a warehouse receives a
-- returned parcel the same way whoever sent it back — so no new receipt
-- flow. What is new is who asked, why, and what it costs.
ALTER TYPE "wallet_entry_direction" ADD VALUE IF NOT EXISTS 'customer_return_fee';

ALTER TABLE "orders"
  ADD COLUMN "customer_return_requested_at" TIMESTAMPTZ,
  ADD COLUMN "customer_return_reason"       TEXT;
