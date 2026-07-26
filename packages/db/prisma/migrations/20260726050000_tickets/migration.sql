-- R7 (revised-plan roadmap) — unified ticket system.
--
-- Additive. One `tickets` table serves BOTH auto-raised scrap/damage
-- claims (from RTO inspection) and seller-raised parcel issues, so ops
-- works a single queue. `ticket_events` is the append-only status
-- history (mirrors order_events).
--
-- Also adds the SCRAP_REFUND wallet direction: a damage ticket resolved
-- in the seller's favour credits them. Kept distinct from
-- ADJUSTMENT_CREDIT (reserved for operator error-correction) so
-- settlements and ledger corrections stay separable in reporting.

ALTER TYPE "wallet_entry_direction" ADD VALUE 'scrap_refund';

CREATE TYPE "ticket_type" AS ENUM (
  'scrap_damage',
  'seller_raised_issue'
);

CREATE TYPE "ticket_status" AS ENUM (
  'open',
  'negotiating',
  'resolved_refund',
  'resolved_returned',
  'resolved_write_off_accepted',
  'rejected'
);

CREATE TABLE "tickets" (
  "id"                         UUID NOT NULL DEFAULT uuidv7(),
  "ticket_type"                "ticket_type" NOT NULL,
  "status"                     "ticket_status" NOT NULL DEFAULT 'open',
  "seller_id"                  UUID NOT NULL,
  "order_id"                   UUID,
  "shipment_id"                UUID,
  "shipment_item_id"           UUID,
  "courier_code"               TEXT,
  "rto_condition"              "rto_item_condition",
  "subject"                    TEXT NOT NULL,
  "description"                TEXT,
  "resolution_amount_inr"      DECIMAL(14, 2),
  "resolution_wallet_entry_id" UUID,
  "resolution_notes"           TEXT,
  "opened_by_staff_id"         UUID,
  "opened_by_seller_user_id"   UUID,
  "resolved_by_staff_id"       UUID,
  "resolved_at"                TIMESTAMPTZ,
  "created_at"                 TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"                 TIMESTAMPTZ NOT NULL,

  CONSTRAINT "tickets_pkey" PRIMARY KEY ("id")
);

-- Auto-raise idempotency: at most one ticket of a type per shipment
-- item. Seller-raised tickets leave shipment_item_id NULL and Postgres
-- allows many NULLs here, so they are unconstrained.
CREATE UNIQUE INDEX "tickets_shipment_item_id_ticket_type_key"
  ON "tickets" ("shipment_item_id", "ticket_type");
CREATE INDEX "tickets_seller_id_status_idx" ON "tickets" ("seller_id", "status");
CREATE INDEX "tickets_status_created_at_idx" ON "tickets" ("status", "created_at");
CREATE INDEX "tickets_ticket_type_idx" ON "tickets" ("ticket_type");
CREATE INDEX "tickets_order_id_idx" ON "tickets" ("order_id");
CREATE INDEX "tickets_shipment_id_idx" ON "tickets" ("shipment_id");

ALTER TABLE "tickets"
  ADD CONSTRAINT "tickets_seller_id_fkey"
    FOREIGN KEY ("seller_id") REFERENCES "sellers"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "tickets"
  ADD CONSTRAINT "tickets_order_id_fkey"
    FOREIGN KEY ("order_id") REFERENCES "orders"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "tickets"
  ADD CONSTRAINT "tickets_shipment_id_fkey"
    FOREIGN KEY ("shipment_id") REFERENCES "shipments"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "tickets"
  ADD CONSTRAINT "tickets_shipment_item_id_fkey"
    FOREIGN KEY ("shipment_item_id") REFERENCES "shipment_items"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "tickets"
  ADD CONSTRAINT "tickets_opened_by_staff_id_fkey"
    FOREIGN KEY ("opened_by_staff_id") REFERENCES "staff_users"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "tickets"
  ADD CONSTRAINT "tickets_opened_by_seller_user_id_fkey"
    FOREIGN KEY ("opened_by_seller_user_id") REFERENCES "seller_users"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "tickets"
  ADD CONSTRAINT "tickets_resolved_by_staff_id_fkey"
    FOREIGN KEY ("resolved_by_staff_id") REFERENCES "staff_users"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "ticket_events" (
  "id"          UUID NOT NULL DEFAULT uuidv7(),
  "ticket_id"   UUID NOT NULL,
  "from_status" "ticket_status",
  "to_status"   "ticket_status" NOT NULL,
  "note"        TEXT,
  "actor_type"  "actor_type" NOT NULL,
  "actor_id"    UUID,
  "created_at"  TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ticket_events_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ticket_events_ticket_id_created_at_idx"
  ON "ticket_events" ("ticket_id", "created_at");

ALTER TABLE "ticket_events"
  ADD CONSTRAINT "ticket_events_ticket_id_fkey"
    FOREIGN KEY ("ticket_id") REFERENCES "tickets"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
