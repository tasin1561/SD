-- Stopping a seller who owes us money from STARTING new work.
--
-- Every capability is an entry point on purpose. Blocking something
-- already in flight does not protect the money: a parcel with the
-- courier still has to be delivered, tracked and returned, and halting
-- that leaves goods stranded we are still paying to move. The three that
-- do touch moving work are offered anyway, because an operator
-- occasionally needs them — the admin screen names what they cost.
--
-- Applied by a person, cleared by the seller's own money: once the
-- wallet reaches clear_at_balance_inr the next thing they do simply
-- works, without waiting for anyone to notice.

CREATE TYPE "seller_capability" AS ENUM (
  'order_create',
  'order_confirm',
  'consignment_create',
  'payout_request',
  'shipment_dispatch',
  'tracking_view',
  'rto_receive'
);

CREATE TABLE "seller_restrictions" (
  "id" UUID NOT NULL DEFAULT uuidv7(),
  "seller_id" UUID NOT NULL,
  "blocked_capabilities" "seller_capability"[] NOT NULL,
  "clear_at_balance_inr" DECIMAL(14,2) NOT NULL,
  "reason" TEXT NOT NULL,
  "created_by_staff_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lifted_at" TIMESTAMPTZ,
  "lifted_by_staff_id" UUID,
  "lift_reason" TEXT,
  "updated_at" TIMESTAMPTZ NOT NULL,
  CONSTRAINT "seller_restrictions_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "seller_restrictions_seller_id_lifted_at_idx"
  ON "seller_restrictions"("seller_id", "lifted_at");

-- At most ONE restriction in force per seller. Two live rows would mean
-- two answers to "is this blocked", and the guard would have to pick.
CREATE UNIQUE INDEX "seller_restrictions_one_active_per_seller"
  ON "seller_restrictions"("seller_id") WHERE "lifted_at" IS NULL;

ALTER TABLE "seller_restrictions"
  ADD CONSTRAINT "seller_restrictions_seller_id_fkey"
  FOREIGN KEY ("seller_id") REFERENCES "sellers"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "seller_restrictions"
  ADD CONSTRAINT "seller_restrictions_created_by_staff_id_fkey"
  FOREIGN KEY ("created_by_staff_id") REFERENCES "staff_users"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "seller_restrictions"
  ADD CONSTRAINT "seller_restrictions_lifted_by_staff_id_fkey"
  FOREIGN KEY ("lifted_by_staff_id") REFERENCES "staff_users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
