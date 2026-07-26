-- Stop crediting sellers before the courier has paid us.
--
-- WHY A MIGRATION AND NOT JUST THE SEED: seedSystemSettings() upserts with
-- a create-only value block (the `update` clause deliberately never
-- touches value_* columns, so re-seeding can't stomp an operator's edit).
-- That means changing the seeded default alone would have NO effect on an
-- already-deployed database — the row is already there. This migration
-- makes the change real where it matters.
--
-- Effect: an order delivered from now on creates a PendingAccrual and is
-- credited accrual_delay_days later by the existing hourly sweep, instead
-- of crediting the seller's wallet the instant the parcel is marked
-- DELIVERED (5-10 days before Delhivery settles with us).
--
-- NOT touched:
--   * seller_setting_overrides — a seller explicitly put on INSTANT stays
--     on INSTANT. This is a change of DEFAULT, not a forced migration.
--   * Orders already credited. Money already in a wallet stays there.

UPDATE "system_settings"
   SET "value_string" = 'T_PLUS_N',
       "updated_at"   = CURRENT_TIMESTAMP
 WHERE "key" = 'wallet.accrual_timing_tier'
   AND "value_string" = 'INSTANT';

-- 7 days covers Delhivery's stated 5-10 day settlement window. Bumped
-- from the placeholder 2, which was short enough to still leave us
-- floating most payouts.
UPDATE "system_settings"
   SET "value_int"  = 7,
       "updated_at" = CURRENT_TIMESTAMP
 WHERE "key" = 'wallet.accrual_delay_days'
   AND "value_int" = 2;
