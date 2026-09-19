-- WHICH CARRIER actually took the parcel, when the courier we booked with
-- is an aggregator.
--
-- Shiprocket's AWB-assign reply names the carrier it picked
-- (`response.data.courier_name`, e.g. "Blue Dart Air") and we were
-- dropping it on the floor. `courier_code` says who we hold the account
-- and the money with; this says whose van it went in — the fact a POD
-- chase, a cost query and "why is this parcel slow" all start from.
-- Delhivery IS the carrier, so its bookings leave this NULL.
--
-- Nullable and unindexed on purpose: a DISPLAY string in their wording,
-- never matched on. No backfill is possible — the reply it comes from
-- was never stored.

-- AlterTable
ALTER TABLE "shipments" ADD COLUMN     "carrier_name" TEXT;
