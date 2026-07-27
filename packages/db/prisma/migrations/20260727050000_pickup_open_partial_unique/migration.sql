-- The one-per-day rule is about OPEN requests, not about the calendar day.
--
-- Delhivery's wording: only one open pickup request per location, and a
-- second is accepted "only when the existing pickup request is closed".
-- The original UNIQUE covered (courier, warehouse, date) unconditionally,
-- which quietly enforced something stricter and wrong: once a morning
-- collection was marked CLOSED, the warehouse could not book an afternoon
-- van for the same day at all. Found by driving the endpoint over HTTP —
-- the unit tests only ever exercised the duplicate-while-open case, which
-- both versions get right.
--
-- Which statuses occupy the day:
--   requested — an open request; a second would be refused by the courier
--   failed    — deliberately occupies. When the call failed we do not know
--               whether Delhivery registered it, and assuming it did not is
--               how two vans arrive. `releaseDay` is the deliberate,
--               audited escape hatch for this case.
--   closed    — the van came. Delhivery permits another; so do we.
--   cancelled — called off before collection. Nothing is booked.

DROP INDEX IF EXISTS "courier_pickup_requests_day_uq";

CREATE UNIQUE INDEX "courier_pickup_requests_open_day_uq"
  ON "courier_pickup_requests" ("courier_code", "warehouse_id", "pickup_date")
  WHERE "status" IN ('requested', 'failed');
