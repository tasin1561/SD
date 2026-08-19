-- The Indian warehouse is in KOLKATA, and always was.
--
-- `BLR-01 / Bangalore Main` was seed data from M0 that nobody corrected.
-- The rest of the system already knew better: courier.delhivery_origin_pincode
-- is 700128 (Kolkata) and the pickup location registered with Delhivery is
-- MSEXPORT. Only this row still said Bangalore — on the receive station, on
-- the consignment panel, and in every goods-receipt email a seller gets.
--
-- The rename has to happen HERE rather than by hand, because
-- scripts/deploy.sh re-runs the seed whenever seed.ts changes and the seed
-- upserts on `code`. Renaming the row without moving the seed's key would
-- leave the next deploy creating a second warehouse — a phantom in every
-- dropdown, while ops.default_warehouse_id still pointed at the real one.
-- The two move together or not at all.
--
-- Guarded on the old code, so re-running finds nothing and does nothing.
-- The id is untouched: ops.default_warehouse_id holds the UUID, and every
-- stock level, batch, movement and receipt is keyed on it.
UPDATE "warehouses"
   SET "code" = 'CCU-01',
       "name" = 'Kolkata Main'
 WHERE "code" = 'BLR-01';
