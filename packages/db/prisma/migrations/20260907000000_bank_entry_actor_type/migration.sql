-- WHO moved this money. `created_by_staff_id` alone could not say: a
-- null there means EITHER "the system posted it" or "we do not know who",
-- and those are different answers to ask a bank book. Ten of the first
-- eighteen rows were null with nothing to tell them apart.
--
-- SYSTEM is the right default for the existing rows: every one of them
-- was written by a settlement, an attribution pair or a top-up
-- acceptance, and the staff-driven ones already carry their staff id.
ALTER TABLE "bank_entries"
  ADD COLUMN "actor_type" "actor_type" NOT NULL DEFAULT 'system';

-- Backfill the truth we DO have: a row naming a person was a person.
UPDATE "bank_entries" SET "actor_type" = 'staff'
 WHERE "created_by_staff_id" IS NOT NULL;

CREATE INDEX "bank_entries_actor_type_idx" ON "bank_entries" ("actor_type");
