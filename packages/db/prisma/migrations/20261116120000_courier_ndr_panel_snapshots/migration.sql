CREATE TABLE "courier_ndr_panel_snapshots" (
  "id"              UUID NOT NULL DEFAULT uuidv7(),
  "shipment_id"     UUID NOT NULL,
  "open"            BOOLEAN,
  "attempts_failed" INTEGER,
  "attempts_max"    INTEGER,
  "deadline_days"   INTEGER,
  "remark_verified" BOOLEAN,
  "reason_text"     TEXT,
  "read_at"         TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "courier_ndr_panel_snapshots_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "courier_ndr_panel_snapshots_shipment_id_read_at_idx"
  ON "courier_ndr_panel_snapshots"("shipment_id", "read_at");

ALTER TABLE "courier_ndr_panel_snapshots"
  ADD CONSTRAINT "courier_ndr_panel_snapshots_shipment_id_fkey"
  FOREIGN KEY ("shipment_id") REFERENCES "shipments"("id") ON DELETE CASCADE ON UPDATE CASCADE;
