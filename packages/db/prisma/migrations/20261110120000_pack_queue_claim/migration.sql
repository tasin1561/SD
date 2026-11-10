-- PACK-4: an EXPIRING pack-queue claim.
--
-- The pack queue had no claim at all (the comment in PackQueueService said
-- so and proposed this), so two packers who pulled a moment apart were both
-- handed the same parcel and only found out at the bench, after walking —
-- `pack_boxes` refuses the second one, which protects the data but wastes
-- the walk. Pack volume has now scaled past that tradeoff.
--
-- Deliberately a SOFT claim: `pack_boxes` (PACK-1) stays the authoritative
-- exclusivity and nothing about what a scan accepts changes. The claim's
-- only job is to keep the QUEUE from offering one parcel twice.
--
-- Expiry is read in the eligibility predicate (`pack_claim_expires_at <=
-- now()`), never swept by a job, so a packer who walks away — shift change,
-- phone call, goes home — cannot strand a parcel until an admin intervenes.
-- Nothing is backfilled: every existing row is correctly "unclaimed".
ALTER TABLE "shipments"
  ADD COLUMN IF NOT EXISTS "pack_claimed_by_staff_id" UUID,
  ADD COLUMN IF NOT EXISTS "pack_claim_expires_at" TIMESTAMPTZ;

DO $$
BEGIN
  ALTER TABLE "shipments"
    ADD CONSTRAINT "shipments_pack_claimed_by_staff_id_fkey"
    FOREIGN KEY ("pack_claimed_by_staff_id") REFERENCES "staff_users"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS "shipments_pack_claimed_by_staff_id_idx"
  ON "shipments" ("pack_claimed_by_staff_id");
CREATE INDEX IF NOT EXISTS "shipments_pack_claim_expires_at_idx"
  ON "shipments" ("pack_claim_expires_at");
