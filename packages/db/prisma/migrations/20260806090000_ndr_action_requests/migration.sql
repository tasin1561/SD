-- Phase 1 NDR orchestration: persist what we asked Delhivery to do.
--
-- The NDR API is asynchronous — it returns a UPL id, not an outcome — so
-- without a row here "did we ask for a re-attempt on this parcel?" has no
-- answer, and the reconciliation job has no input.

CREATE TYPE "ndr_request_status" AS ENUM ('submitted', 'confirmed', 'failed', 'escalated');

-- A courier-escalation ticket joins the existing ops queue rather than
-- starting a second one.
ALTER TYPE "ticket_type" ADD VALUE IF NOT EXISTS 'courier_ndr_escalation';

CREATE TABLE "ndr_action_requests" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "shipment_id" UUID NOT NULL,
    "awb_number" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "nsl_code_at_submit" TEXT,
    "attempt_count_at_submit" INTEGER NOT NULL,
    "status" "ndr_request_status" NOT NULL DEFAULT 'submitted',
    "upl_id" TEXT,
    "courier_message" TEXT,
    "submitted_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "polled_at" TIMESTAMPTZ,
    "poll_attempts" INTEGER NOT NULL DEFAULT 0,
    "reconciled_at" TIMESTAMPTZ,
    "new_attempt_seen" BOOLEAN,
    "ticket_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,
    CONSTRAINT "ndr_action_requests_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ndr_action_requests_status_submitted_at_idx"
    ON "ndr_action_requests"("status", "submitted_at");
CREATE INDEX "ndr_action_requests_shipment_id_idx" ON "ndr_action_requests"("shipment_id");
CREATE INDEX "ndr_action_requests_awb_number_idx" ON "ndr_action_requests"("awb_number");

-- ONE in-flight request per shipment. This is the gate against a retried
-- batch, or two operators, sending the same parcel twice in one night —
-- an application-level "have we already asked?" read under READ COMMITTED
-- lets both callers see "no" and both proceed.
CREATE UNIQUE INDEX "ndr_action_requests_one_in_flight_per_shipment"
    ON "ndr_action_requests"("shipment_id") WHERE "status" = 'submitted';

ALTER TABLE "ndr_action_requests"
    ADD CONSTRAINT "ndr_action_requests_shipment_id_fkey"
    FOREIGN KEY ("shipment_id") REFERENCES "shipments"("id") ON DELETE CASCADE ON UPDATE CASCADE;
