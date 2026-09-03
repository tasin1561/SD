-- The handover scan.
--
-- When `ops.handover_scan_required` is on, a parcel must be scanned at
-- the bench immediately before the driver takes it, and the handoff
-- REFUSES anything unscanned — enforced in the service, so it holds for
-- the API as well as the screen.
ALTER TABLE "shipments"
  ADD COLUMN "handover_scanned_at" TIMESTAMPTZ,
  ADD COLUMN "handover_scanned_by_staff_id" UUID;

CREATE INDEX "shipments_handover_scanned_at_idx" ON "shipments"("handover_scanned_at");

ALTER TABLE "shipments"
  ADD CONSTRAINT "shipments_handover_scanned_by_staff_id_fkey"
  FOREIGN KEY ("handover_scanned_by_staff_id") REFERENCES "staff_users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
