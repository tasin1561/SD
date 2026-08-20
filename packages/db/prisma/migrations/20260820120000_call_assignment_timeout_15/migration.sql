-- CC-7 assignment expiry: 30 minutes → 15.
--
-- The seed alone cannot do this. `seedSystemSettings()` is create-only on
-- the value columns — it will not overwrite a key that already exists —
-- so a deployed database keeps whatever it was first seeded with. The
-- same trap was hit changing the wallet accrual tier in R2c.
--
-- Guarded on the old value so an operator who has already tuned this in
-- the settings UI is not silently overruled by a deploy.
UPDATE "system_settings"
   SET "value_int" = 15,
       "updated_at" = now()
 WHERE "key" = 'ops.call_assignment_timeout_minutes'
   AND "value_int" = 30;
