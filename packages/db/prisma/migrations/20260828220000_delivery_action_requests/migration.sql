-- A seller asking us to do something about a failed delivery.
--
-- The seller ASKS; an operator (or an explicitly enabled runner) decides
-- and executes. That separation is CUR-10 and it is not ceremony: a
-- re-attempt sends a van and an RTO turns a moving parcel into a return,
-- so a seller-facing handler must never fire one directly.
--
-- RECALL is the exception that proves the shape — it asks our own call
-- centre to phone the customer and reaches no courier at all.
CREATE TYPE "delivery_action_kind" AS ENUM ('reattempt', 'recall', 'rto');

CREATE TYPE "delivery_action_status" AS ENUM (
  'pending', 'approved', 'rejected', 'executed', 'failed'
);

CREATE TABLE "order_delivery_action_requests" (
  "id"                  UUID PRIMARY KEY DEFAULT uuidv7(),
  "order_id"            UUID NOT NULL,
  "shipment_id"         UUID NOT NULL,
  "seller_id"           UUID NOT NULL,
  "requested_by_id"     UUID,
  "action"              "delivery_action_kind" NOT NULL,
  "reason"              TEXT NOT NULL,
  "status"              "delivery_action_status" NOT NULL DEFAULT 'pending',
  -- The failed delivery this answers, so a request cannot be read as a
  -- response to an NDR that had not happened yet.
  "delivery_attempt_id" UUID,
  "decided_by_id"       UUID,
  "decided_at"          TIMESTAMPTZ,
  "decision_note"       TEXT,
  "executed_at"         TIMESTAMPTZ,
  -- Delhivery returns a UPL id, not an outcome; the result arrives later
  -- on a scan.
  "execution_ref"       TEXT,
  "execution_error"     TEXT,
  "created_at"          TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updated_at"          TIMESTAMPTZ NOT NULL,

  CONSTRAINT "order_delivery_action_requests_order_id_fkey"
    FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT "order_delivery_action_requests_shipment_id_fkey"
    FOREIGN KEY ("shipment_id") REFERENCES "shipments"("id") ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT "order_delivery_action_requests_seller_id_fkey"
    FOREIGN KEY ("seller_id") REFERENCES "sellers"("id") ON UPDATE CASCADE ON DELETE RESTRICT
);

CREATE INDEX "order_delivery_action_requests_seller_id_status_idx"
  ON "order_delivery_action_requests"("seller_id", "status");
CREATE INDEX "order_delivery_action_requests_order_id_idx"
  ON "order_delivery_action_requests"("order_id");
CREATE INDEX "order_delivery_action_requests_status_created_at_idx"
  ON "order_delivery_action_requests"("status", "created_at");
