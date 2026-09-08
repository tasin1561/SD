-- The nightly Delhivery wallet sync asked for 45 days of ledger and
-- every export came back covering about seven. Seven is what their
-- Finances export actually returns, so 45 was never a wider read — it
-- was a mismatch the coverage alarm raised every single night.
--
-- A migration and not just a seed edit: `seedSystemSettings()` is
-- create-only on the value columns, so changing the default alone would
-- leave the deployed row on 45 and the alarm firing for ever. Same
-- reason 2026-07-26's accrual tier and 2026-09-03's auto-pickup
-- defaults each needed one.
--
-- What this gives up, stated rather than discovered later: a charge
-- Delhivery re-cuts MORE than seven days after the parcel moved is not
-- picked up by the nightly run. Catching one means exporting a wider
-- range by hand and uploading it on the Delhivery screen. The alarm
-- still fires if an export ever comes back materially SHORTER than the
-- seven we now ask for, which would be a real regression.
UPDATE system_settings
SET value_int = 7,
    updated_at = NOW()
WHERE key = 'courier.wallet_sync_window_days'
  AND value_int = 45;
