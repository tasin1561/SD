-- A seller ASKING for one more call on an order the customer refused.
--
-- REJECTED_BY_CUSTOMER is terminal because the customer said no. A
-- seller who could put that order back in the queue unaided is a seller
-- who can have someone rung repeatedly after they refused, which in a
-- COD market costs the customer rather than just the parcel. So this is
-- a request with a human between it and the phone call.

CREATE TYPE "reattempt_request_status" AS ENUM ('pending', 'approved', 'rejected');

CREATE TABLE "order_reattempt_requests" (
  "id"                      UUID PRIMARY KEY DEFAULT uuidv7(),
  "order_id"                UUID NOT NULL,
  "seller_id"               UUID NOT NULL,
  "requested_by_id"         UUID,
  "reason"                  TEXT NOT NULL,
  "status"                  "reattempt_request_status" NOT NULL DEFAULT 'pending',
  "decided_by_id"           UUID,
  "decided_at"              TIMESTAMPTZ,
  "decision_note"           TEXT,
  "order_status_at_request" TEXT NOT NULL,
  "created_at"              TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updated_at"              TIMESTAMPTZ NOT NULL,
  -- ON UPDATE CASCADE on every FK: Prisma emits it for all relations,
  -- and omitting it leaves the column NO ACTION and fails the drift gate
  -- on a key that otherwise looks identical.
  CONSTRAINT "order_reattempt_requests_order_id_fkey"
    FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "order_reattempt_requests_seller_id_fkey"
    FOREIGN KEY ("seller_id") REFERENCES "sellers"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "order_reattempt_requests_requested_by_id_fkey"
    FOREIGN KEY ("requested_by_id") REFERENCES "seller_users"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "order_reattempt_requests_decided_by_id_fkey"
    FOREIGN KEY ("decided_by_id") REFERENCES "staff_users"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX "order_reattempt_requests_seller_id_status_idx"
  ON "order_reattempt_requests" ("seller_id", "status");
CREATE INDEX "order_reattempt_requests_status_created_at_idx"
  ON "order_reattempt_requests" ("status", "created_at");
CREATE INDEX "order_reattempt_requests_order_id_idx"
  ON "order_reattempt_requests" ("order_id");

-- At most one UNDECIDED request per order. A partial unique rather than
-- an application check: a read-then-write guard under READ COMMITTED
-- lets two clicks both see "no open request" and both insert, and the
-- admin queue then shows the same plea twice. Partial, because a
-- REJECTED request must not block the seller from ever asking again on
-- new grounds.
CREATE UNIQUE INDEX "order_reattempt_requests_one_open_per_order_uq"
  ON "order_reattempt_requests" ("order_id")
  WHERE "status" = 'pending';
