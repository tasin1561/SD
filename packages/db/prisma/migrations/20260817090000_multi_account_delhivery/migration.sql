-- Multiple Delhivery accounts, in parallel.
--
-- R1 built CourierAccount, the seller links and the weighted routing,
-- and stamped `shipments.courier_account_id` — but the resolution was
-- FOR TRACEABILITY ONLY. Every actual API call still authenticated with
-- whichever credential `findFirst` returned, so a second account would
-- have recorded shipments against one account while creating them under
-- another. That is worse than not supporting it: nothing errors, and the
-- margin report, the settlement matching and the audit trail are all
-- confidently wrong.
--
-- Two things had no per-account identity at all, and both are physical
-- rather than bookkeeping:
--
--   A WAYBILL is bought by one account and is only valid on shipments
--   created under that account's token. The pool was keyed on
--   courier_code alone, so a claim could hand account B's parcel a
--   number account A had paid for.
--
--   A PICKUP LOCATION is registered per account, and Delhivery matches
--   `pickup_location.name` exactly WITHIN that account. One global
--   setting cannot describe two accounts.
--
-- Nothing to backfill: production holds zero pooled waybills and zero
-- AWBs, so every row this touches does not yet exist.

-- Which account bought a pooled waybill. NULL means "pooled before any
-- account existed" and is claimable only by a call that resolved no
-- account either — a null here must never be treated as "any account
-- may take it", which is the exact silent-mixing this prevents.
ALTER TABLE "courier_waybills"
  ADD COLUMN "courier_account_id" UUID;

ALTER TABLE "courier_waybills"
  ADD CONSTRAINT "courier_waybills_courier_account_id_fkey"
  FOREIGN KEY ("courier_account_id") REFERENCES "courier_accounts"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- The claim query filters on (account, status, usable_after).
CREATE INDEX "courier_waybills_courier_account_id_status_usable_after_idx"
  ON "courier_waybills"("courier_account_id", "status", "usable_after");

-- The warehouse name this account sends as pickup_location.name. NULL
-- falls back to the global courier.delhivery_pickup_location setting,
-- which is what a single-account setup uses and what production runs
-- today.
ALTER TABLE "courier_accounts"
  ADD COLUMN "pickup_location_name" TEXT;
