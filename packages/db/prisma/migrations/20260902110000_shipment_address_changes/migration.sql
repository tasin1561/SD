-- Every change to a live parcel's consignee details, and whether the
-- courier actually took it.
--
-- APPEND-ONLY, like order_events and stock_movements: the point of an
-- audit trail is that it cannot be tidied afterwards.
--
-- BEFORE *and* AFTER, because "the phone is now X" answers a different
-- question from "it used to be Y", and when a parcel reaches the wrong
-- person the second one is what matters.
--
-- courier_accepted_at and verified_at are deliberately separate facts:
-- the first means their API returned success, the second means we went
-- and looked. A system that conflates them tells a seller an address is
-- fixed on the strength of a 200.
CREATE TABLE "shipment_address_changes" (
  "id"                    UUID PRIMARY KEY DEFAULT uuidv7(),
  "shipment_id"           UUID NOT NULL,

  "actor_type"            "actor_type" NOT NULL,
  "seller_id"             UUID,
  "requested_by_staff_id" UUID,

  -- NULL on both sides means the field was not part of this change.
  -- Distinct from '', which is a value somebody set.
  "name_before"           TEXT,
  "name_after"            TEXT,
  "phone_before"          TEXT,
  "phone_after"           TEXT,
  "address_before"        TEXT,
  "address_after"         TEXT,

  "courier_accepted_at"   TIMESTAMPTZ,
  "courier_message"       TEXT,

  "verified_at"           TIMESTAMPTZ,
  "verified_match"        BOOLEAN,
  "verification_note"     TEXT,

  "created_at"            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX "shipment_address_changes_shipment_id_created_at_idx"
  ON "shipment_address_changes" ("shipment_id", "created_at");

-- The verification sweep's own query: accepted, not yet looked at.
CREATE INDEX "shipment_address_changes_verified_at_idx"
  ON "shipment_address_changes" ("verified_at");

-- Named and actioned exactly as Prisma would generate them. The drift
-- check compares constraint NAMES and referential ACTIONS, not just
-- that a foreign key exists — an inline REFERENCES passes neither.
ALTER TABLE "shipment_address_changes"
  ADD CONSTRAINT "shipment_address_changes_shipment_id_fkey"
  FOREIGN KEY ("shipment_id") REFERENCES "shipments"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- Optional relation with no onDelete in the schema, so Prisma's default
-- for a nullable FK: the seller row going away must not take the audit
-- trail with it.
ALTER TABLE "shipment_address_changes"
  ADD CONSTRAINT "shipment_address_changes_seller_id_fkey"
  FOREIGN KEY ("seller_id") REFERENCES "sellers"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
