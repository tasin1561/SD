-- A confirmed parcel waiting for somebody to choose its courier.
--
-- Shiprocket offers several couriers per parcel at different rates and
-- speeds, and until now nobody chose: we sent `assign/awb` with no
-- `courier_id`, so their own ranking decided. Their ranking is not
-- "cheapest" — on one measured route it took Blue Dart at ₹92.40 over
-- Ekart at ₹69.36 — so every parcel was priced by a preference nobody
-- had expressed.
--
-- `courier.selection_policy` now decides. On MANUAL a person does, and
-- the order pauses in this status: after the confirmation call, before
-- printing. Only ever for Shiprocket, and only when more than one
-- option exists — Delhivery offers no choice, and a pause with nothing
-- to decide is pure delay.
--
-- The enum value is added at the END rather than in lifecycle position:
-- Postgres enum ordering is physical, and BEFORE/AFTER on an existing
-- value cannot run inside a transaction on some versions. Nothing reads
-- these in enum order.
ALTER TYPE "order_status" ADD VALUE IF NOT EXISTS 'awaiting_courier';

-- The options the carrier offered for THIS parcel, snapshotted when the
-- order confirmed, so every admin sees the same figures and the decision
-- page needs no courier round trip. Stale by construction; the fetch
-- time is stored beside it and shown.
ALTER TABLE "shipments" ADD COLUMN "courier_options" JSONB;
ALTER TABLE "shipments" ADD COLUMN "courier_options_fetched_at" TIMESTAMPTZ;
ALTER TABLE "shipments" ADD COLUMN "chosen_courier_company_id" INTEGER;
ALTER TABLE "shipments" ADD COLUMN "courier_chosen_by_staff_id" UUID;
ALTER TABLE "shipments" ADD COLUMN "courier_chosen_at" TIMESTAMPTZ;

ALTER TABLE "shipments"
  ADD CONSTRAINT "shipments_courier_chosen_by_staff_id_fkey"
  FOREIGN KEY ("courier_chosen_by_staff_id") REFERENCES "staff_users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
