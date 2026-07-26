-- R6 (revised-plan roadmap) — record WHERE an RTO parcel was physically
-- received, which can legitimately differ from the warehouse it
-- dispatched from.
--
-- Additive + nullable: every existing shipment keeps NULL, and every
-- consumer falls back to origin_warehouse_id when NULL, so behavior is
-- byte-identical to pre-R6 for all existing data and all same-warehouse
-- returns.

ALTER TABLE "shipments" ADD COLUMN "rto_received_warehouse_id" UUID;

CREATE INDEX "shipments_rto_received_warehouse_id_idx"
  ON "shipments" ("rto_received_warehouse_id");

ALTER TABLE "shipments"
  ADD CONSTRAINT "shipments_rto_received_warehouse_id_fkey"
    FOREIGN KEY ("rto_received_warehouse_id") REFERENCES "warehouses"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
