-- Re-read ninety days a night, not seven.
--
-- `seedSystemSettings()` is create-only on value columns, so editing the
-- seed alone would never touch the deployed row — the same reason the
-- accrual-tier default needed a migration rather than a seed edit.
--
-- Seven was a real constraint while the import OVERWROTE a parcel's cost
-- with the latest debit it happened to see: a wide window meant re-
-- applying old rows, and a charge re-cut more than seven days after the
-- parcel moved was never picked up at all. Now that every transaction is
-- stored under the courier's own id, the overlap is recognised and
-- skipped, so the window costs nothing and ninety days is simply as far
-- back as their date picker reaches.
UPDATE "system_settings"
   SET "value_int" = 90
 WHERE "key" = 'courier.wallet_sync_window_days'
   AND "value_int" = 7;
