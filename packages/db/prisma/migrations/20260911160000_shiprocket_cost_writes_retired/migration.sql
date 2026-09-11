-- The Shiprocket API cost sync no longer writes a parcel's cost: the
-- wallet ledger (their passbook, read nightly) is the only writer, and the
-- API sync CHECKS their final bill against it. Its "write the costs"
-- switch would now control nothing, and a switch that does nothing is
-- worse than none — somebody flips it and believes it. The seed is
-- create-only, so removing it there alone would leave the deployed row.
DELETE FROM "system_settings" WHERE "key" = 'courier.shiprocket_cost_sync_writes_enabled';
