-- Module 5: bump the default stock-reservation TTL from 24h to 48h.
--
-- The seed upsert deliberately never overwrites a system_settings value on
-- re-run (system_settings is admin-editable runtime config), so changing the
-- seed literal alone does NOT move an already-seeded row. This data migration
-- handles existing databases.
--
-- Guarded: only rows still holding the OLD seeded default (24) are bumped, so
-- an operator who already retuned this value via the settings UI is preserved.
-- No schema change — this is a data-only migration.
UPDATE "system_settings"
SET "value_int" = 48
WHERE "key" = 'ops.stock_reservation_ttl_hours'
  AND "value_int" = 24;
