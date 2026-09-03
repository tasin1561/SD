-- Auto-pickup is now a standing decision, not an opt-in.
--
-- WHY A MIGRATION AND NOT JUST THE SEED: seedSystemSettings() upserts with
-- a create-only value block (the `update` clause deliberately never
-- touches value_* columns, so re-seeding can't stomp an operator's edit).
-- These two rows were created OFF three commits ago and a re-seed alone
-- would leave an already-deployed database exactly where it was. This
-- migration makes the change real where it matters — mirrors
-- 20260726110000_default_accrual_t_plus_n exactly, same reason.
--
-- Effect: the FIRST box packed each day at a warehouse now asks that
-- courier for a van without anyone visiting the Pickups screen; every
-- later box that day is a no-op, because one request already covers the
-- building (CUR-10 amendment #3). The kill switch stays real — this only
-- changes the DEFAULT, and flipping either row back to false in
-- system_settings (or from /settings) returns to raising every pickup
-- by hand, with no deploy required.
--
-- Guarded on the OLD value so an operator who had already turned one of
-- these on or off by hand before this migration ran is left alone.
UPDATE "system_settings"
   SET "value_boolean" = true,
       "updated_at"    = CURRENT_TIMESTAMP
 WHERE "key" IN ('courier.delhivery_auto_pickup_enabled', 'courier.shiprocket_auto_pickup_enabled')
   AND "value_boolean" = false;
