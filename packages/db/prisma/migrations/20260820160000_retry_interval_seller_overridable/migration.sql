-- Make the no-response retry interval per-seller overridable (SET-1).
--
-- The seed cannot do this: seedSystemSettings() is create-only on the
-- value AND override columns, so a deployed row keeps whatever it was
-- first created with. Without this UPDATE the key stays global-only in
-- production and the per-seller settings UI would simply not offer it.
--
-- The clamp is the load-bearing part. A minimum of one hour makes the
-- instant-redial bug this delay exists to fix unrepresentable per
-- seller: SettingsResolverService enforces overrideMin/Max AT WRITE
-- TIME, so nobody can put a customer back on a seconds-later redial by
-- typing 0 into a form.
UPDATE "system_settings"
   SET "seller_overridable" = true,
       "override_min_int"   = 1,
       "override_max_int"   = 72,
       "updated_at"         = now()
 WHERE "key" = 'ops.call_retry_interval_hours';
