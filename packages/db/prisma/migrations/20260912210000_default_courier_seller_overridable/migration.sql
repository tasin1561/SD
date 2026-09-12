-- Make the default courier per-seller overridable (SET-1).
--
-- Why: running real money-flow tests on production for ONE seller needs
-- that seller's parcels carried by the MANUAL courier, so no real
-- Delhivery/Shiprocket waybill is booked — without flipping the global
-- default for every seller. Provisioning now resolves this key per seller
-- through SettingsResolverService.
--
-- The seed cannot do this on the deployed row (deploy runs migrations,
-- not the seed), so the flag is set here. Nothing else on the row is
-- touched: the global value stays whatever production has it at.
-- An override is validated against the couriers table at write time.
UPDATE "system_settings"
   SET "seller_overridable" = true,
       "updated_at"         = now()
 WHERE "key" = 'ops.default_courier_code';
