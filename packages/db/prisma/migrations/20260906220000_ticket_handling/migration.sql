-- WHO is carrying a ticket to the courier. Only Delhivery has ticket
-- automation; a Shiprocket or manually-placed parcel has no portal to
-- drive, so its issue only moves if a person moves it. Saying so on the
-- ticket is what stops it sitting in a queue nobody watches because
-- everybody assumed software had it.
CREATE TYPE "ticket_handling" AS ENUM ('none', 'auto', 'manual');

ALTER TABLE "tickets"
  ADD COLUMN "handling" "ticket_handling" NOT NULL DEFAULT 'none';

CREATE INDEX "tickets_handling_idx" ON "tickets" ("handling");

-- SUPERVISED by default, not MANUAL. The worker prepares the raise and
-- holds it for one click, which is how the portal selectors get exercised
-- with somebody watching. seedSystemSettings is create-only on value
-- columns, so the already-deployed row needs this rather than a seed edit.
UPDATE "courier_channel_settings"
   SET "write_mode" = 'supervised'
 WHERE "courier_code" = 'delhivery'
   AND "write_mode" = 'manual';
