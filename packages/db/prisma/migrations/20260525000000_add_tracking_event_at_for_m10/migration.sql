-- Module 10 (TRK-3) — add the SCAN-timestamp column tracking_events.event_at
-- so the public-customer timeline + the monotonic-forward transition
-- guard order on scan time, never receipt time. The hypertable partition
-- key stays created_at (canonical Timescale pattern: partition by
-- insertion time, sort by event time at the application layer).
--
-- Safe-by-construction: tracking_events is empty in every environment
-- before M10 (no flow drove a scan write — M8 manifest close left only
-- an audit-stub; M9 generation/dispatch never wrote to tracking_events).
-- We add the column NULL-first then SET NOT NULL — TimescaleDB's
-- columnstore-enabled hypertable disallows ADD COLUMN with a
-- non-constant default expression (NOW()), and a static value would be
-- a lie for any future row. SET NOT NULL passes because the table is
-- empty.

ALTER TABLE "tracking_events"
  ADD COLUMN "event_at" TIMESTAMPTZ;

ALTER TABLE "tracking_events"
  ALTER COLUMN "event_at" SET NOT NULL;

-- Public read + monotonic-forward guard sort. The existing
-- (shipment_id, created_at DESC) index is kept for insertion-order
-- audit queries; this new index drives the customer-visible timeline.
CREATE INDEX "tracking_events_shipment_id_event_at_idx"
  ON "tracking_events"("shipment_id", "event_at" DESC);
