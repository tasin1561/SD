-- Pickup requests: asking Delhivery to send a van to a warehouse.
--
-- The record exists for one reason above all others: Delhivery permits
-- only ONE open pickup request per location per day, and a second is
-- accepted "only when the existing request is closed". Without a record
-- of what we already asked for, a retry after a network timeout either
-- books a second van or earns a confusing rejection — and neither is
-- discoverable from our side afterwards.
--
-- The UNIQUE below IS that rule. Two supervisors clicking at the same
-- moment cannot both raise one; a retry cannot silently duplicate.

CREATE TYPE "pickup_request_status" AS ENUM (
  'requested',
  'failed',
  'closed',
  'cancelled'
);

CREATE TABLE "courier_pickup_requests" (
  "id"                     UUID         NOT NULL DEFAULT uuidv7(),
  "courier_code"           TEXT         NOT NULL,
  "warehouse_id"           UUID         NOT NULL,
  "pickup_location_name"   TEXT         NOT NULL,
  "pickup_date"            DATE         NOT NULL,
  "pickup_time"            TEXT         NOT NULL,
  "expected_package_count" INTEGER      NOT NULL,
  "status"                 "pickup_request_status" NOT NULL DEFAULT 'requested',
  "courier_pickup_id"      TEXT,
  "courier_message"        TEXT,
  "requested_by_staff_id"  UUID,
  "created_at"             TIMESTAMPTZ  NOT NULL DEFAULT now(),
  "updated_at"             TIMESTAMPTZ  NOT NULL,

  CONSTRAINT "courier_pickup_requests_pkey" PRIMARY KEY ("id")
);

-- One open request per (courier, warehouse, day). A FAILED row still
-- occupies the day deliberately: if the call failed we do not know
-- whether Delhivery registered it, and quietly allowing a retry is how
-- two vans get booked. Clearing it is a conscious act.
CREATE UNIQUE INDEX "courier_pickup_requests_day_uq"
  ON "courier_pickup_requests" ("courier_code", "warehouse_id", "pickup_date");

CREATE INDEX "courier_pickup_requests_status_idx"
  ON "courier_pickup_requests" ("status");
CREATE INDEX "courier_pickup_requests_pickup_date_idx"
  ON "courier_pickup_requests" ("pickup_date");

ALTER TABLE "courier_pickup_requests"
  ADD CONSTRAINT "courier_pickup_requests_warehouse_id_fkey"
  FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- SET NULL rather than RESTRICT: a staff member leaving must not make
-- the pickup history undeletable, and "who asked" is also in audit_logs.
ALTER TABLE "courier_pickup_requests"
  ADD CONSTRAINT "courier_pickup_requests_requested_by_staff_id_fkey"
  FOREIGN KEY ("requested_by_staff_id") REFERENCES "staff_users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
