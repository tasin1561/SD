-- TKT-2: "we have passed this on to the courier", as its own append-only
-- row rather than a column on the message it refers to (ticket_events is
-- append-only per TKT-1). The row's existence IS the delivered state;
-- the UNIQUE makes marking it twice a no-op rather than a second claim.
CREATE TABLE "ticket_message_relays" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "ticket_event_id" UUID NOT NULL,
    "relayed_by_staff_id" UUID,
    "relayed_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ticket_message_relays_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ticket_message_relays_ticket_event_id_key" ON "ticket_message_relays"("ticket_event_id");

ALTER TABLE "ticket_message_relays" ADD CONSTRAINT "ticket_message_relays_ticket_event_id_fkey" FOREIGN KEY ("ticket_event_id") REFERENCES "ticket_events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ticket_message_relays" ADD CONSTRAINT "ticket_message_relays_relayed_by_staff_id_fkey" FOREIGN KEY ("relayed_by_staff_id") REFERENCES "staff_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
