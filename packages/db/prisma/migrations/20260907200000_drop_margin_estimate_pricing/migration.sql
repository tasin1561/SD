-- The invoice is the only thing that says what a parcel cost.
--
-- A nightly job was added that asked Delhivery's rate CALCULATOR what
-- each unpriced parcel would cost and wrote the answer into
-- `shipments.actual_courier_cost_inr`. That column is the INVOICED
-- figure, and the P&L reads it as measured cost — so an estimate landed
-- there indistinguishable from a real charge, same column, same
-- `actual_courier_cost_at` stamp, nothing to tell them apart.
--
-- The nightly WALLET LEDGER sync already does the real thing: it
-- downloads the courier's own ledger and writes what they actually
-- billed, overwriting any earlier figure. It was running before the
-- estimate job was written, and it is the single source of this number.
--
-- The job is gone. Its settings go with it — a switch for something
-- that no longer exists is worse than no switch, because somebody will
-- turn it on and reasonably expect it to do something.
DELETE FROM "system_settings"
WHERE "key" IN (
  'courier.margin_nightly_pricing_enabled',
  'courier.margin_nightly_pricing_limit',
  'courier.margin_nightly_pricing_min_age_hours'
);
