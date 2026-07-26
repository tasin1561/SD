-- R5 (revised-plan roadmap) — two-stage ("virtual") inventory booking.
--
-- Additive. `stock_reservations.booking_stage` defaults to
-- 'at_confirmation', so every existing row and every seller who has NOT
-- opted into at-placement booking behaves exactly as before.

CREATE TYPE "reservation_booking_stage" AS ENUM (
  'at_placement',
  'at_confirmation'
);

CREATE TYPE "early_reservation_review_status" AS ENUM (
  'open',
  'seller_released',
  'seller_requested_more_attempts',
  'auto_released'
);

-- Two new release reasons so the unbook paths stay separable from
-- CALL_CANCELLED (customer declined) and EXPIRED (TTL sweep).
ALTER TYPE "reservation_release_reason" ADD VALUE 'ndr_cap_reached';
ALTER TYPE "reservation_release_reason" ADD VALUE 'seller_released';

ALTER TABLE "stock_reservations"
  ADD COLUMN "booking_stage" "reservation_booking_stage" NOT NULL DEFAULT 'at_confirmation';

CREATE INDEX "stock_reservations_order_id_booking_stage_status_idx"
  ON "stock_reservations" ("order_id", "booking_stage", "status");

CREATE TABLE "early_reservation_reviews" (
  "id"                  UUID NOT NULL DEFAULT uuidv7(),
  "order_id"            UUID NOT NULL,
  "seller_id"           UUID NOT NULL,
  "status"              "early_reservation_review_status" NOT NULL DEFAULT 'open',
  "attempt_count"       INTEGER NOT NULL,
  "held_qty"            INTEGER NOT NULL,
  "resolved_at"         TIMESTAMPTZ,
  "resolved_by_user_id" UUID,
  "note"                TEXT,
  "created_at"          TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"          TIMESTAMPTZ NOT NULL,

  CONSTRAINT "early_reservation_reviews_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "early_reservation_reviews_order_id_key"
  ON "early_reservation_reviews" ("order_id");
CREATE INDEX "early_reservation_reviews_seller_id_status_idx"
  ON "early_reservation_reviews" ("seller_id", "status");
CREATE INDEX "early_reservation_reviews_status_created_at_idx"
  ON "early_reservation_reviews" ("status", "created_at");

ALTER TABLE "early_reservation_reviews"
  ADD CONSTRAINT "early_reservation_reviews_order_id_fkey"
    FOREIGN KEY ("order_id") REFERENCES "orders"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "early_reservation_reviews"
  ADD CONSTRAINT "early_reservation_reviews_seller_id_fkey"
    FOREIGN KEY ("seller_id") REFERENCES "sellers"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "early_reservation_reviews"
  ADD CONSTRAINT "early_reservation_reviews_resolved_by_user_id_fkey"
    FOREIGN KEY ("resolved_by_user_id") REFERENCES "seller_users"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
