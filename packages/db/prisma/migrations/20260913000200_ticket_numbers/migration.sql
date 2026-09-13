-- Every ticket gets a number a person can read aloud: TK-YYYY-NNNNNN.
--
-- Until now a ticket had only its uuid, so the seller's ticket page was
-- /tickets/01a09abd-ebc7-… and there was nothing to quote down a phone.
-- New tickets are numbered by TicketService.open, inside the transaction
-- that inserts them, from the per-year sequence ticket_number_seq_<YYYY>
-- (the ORD-8 pattern; see apps/api/.../ticket/services/ticket-numbering.ts).
--
-- BACKFILL ORDER. Existing tickets are numbered from the SAME sequences,
-- oldest first — ORDER BY created_at, then id (uuidv7, so ties break in
-- insertion order too) — so the numbers read in the order the tickets were
-- raised, and the year is the UTC year of created_at, which is the year
-- the service would have used had it existed then. Because the backfill
-- draws with nextval, each sequence is left exactly past the last number
-- it handed out, and the next ticket continues from there: nothing to
-- setval. Production had three tickets, all 2026, so they become
-- TK-2026-000001..000003 in the order they were opened.
--
-- Column nullable → backfill → NOT NULL + unique, so the constraint is only
-- asserted once every row has a value. On an empty table (a fresh test
-- database) the loops do nothing.

ALTER TABLE "tickets" ADD COLUMN "ticket_number" TEXT;

DO $$
DECLARE
  r RECORD;
  serial TEXT;
BEGIN
  FOR r IN
    SELECT DISTINCT EXTRACT(YEAR FROM created_at AT TIME ZONE 'UTC')::int AS y FROM "tickets"
  LOOP
    EXECUTE format('CREATE SEQUENCE IF NOT EXISTS %I START 1', 'ticket_number_seq_' || r.y);
  END LOOP;

  FOR r IN
    SELECT id, EXTRACT(YEAR FROM created_at AT TIME ZONE 'UTC')::int AS y
    FROM "tickets"
    WHERE ticket_number IS NULL
    ORDER BY created_at, id
  LOOP
    serial := nextval(('ticket_number_seq_' || r.y)::regclass)::text;
    -- lpad TRUNCATES a longer string; padStart in the service does not.
    IF length(serial) < 6 THEN
      serial := lpad(serial, 6, '0');
    END IF;
    UPDATE "tickets" SET ticket_number = 'TK-' || r.y || '-' || serial WHERE id = r.id;
  END LOOP;
END $$;

ALTER TABLE "tickets" ALTER COLUMN "ticket_number" SET NOT NULL;

CREATE UNIQUE INDEX "tickets_ticket_number_key" ON "tickets"("ticket_number");
