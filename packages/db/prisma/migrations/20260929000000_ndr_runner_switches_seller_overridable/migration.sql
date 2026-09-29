-- The two NDR runner gates become seller-overridable (SET-1).
--
-- `seedSystemSettings()` does carry `sellerOverridable` in its `update:`
-- block, so a reseed would flip these rows too — but the deploy only
-- reseeds when seed.ts (or the schema) changed, and nothing else in the
-- pipeline guarantees the seed ran at all. A flag that decides whether a
-- screen offers an override is not a thing to leave to that: without the
-- flag `SettingsResolverService.resolve()` never even LOOKS at
-- `seller_setting_overrides`, so the whole per-seller narrowing would be
-- dead code that silently did nothing. Same reasoning as the 2026-09-03
-- auto-pickup default and the 2026-07-26 accrual tier.
--
-- This changes NOTHING about who fires a van today: the global kill
-- switch stays FALSE and the global allow list stays EMPTY, and a seller
-- override may only ever NARROW those (`narrowNdrGate`). Making a key
-- overridable cannot, by construction, turn anything on.
UPDATE "system_settings"
   SET "seller_overridable" = TRUE
 WHERE "key" IN ('courier.ndr_runner_enabled', 'courier.ndr_auto_categories');
