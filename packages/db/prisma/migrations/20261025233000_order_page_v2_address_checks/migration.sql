-- Order page v2 + Solustation address checks (2026-10-25).
--
-- ADDITIVE ONLY, and that is the point rather than a nicety: the old
-- order pages stay in production, serving every seller, for at least two
-- weeks after the new ones take over. Nothing here changes a column the
-- old pages read, narrows a constraint they satisfy, or adds a NOT NULL
-- they do not fill. An order placed by the old page after this migration
-- is byte-for-byte the row it would have been before it.

-- WHICH SCREEN placed it. Null means the old page — which is every order
-- ever placed, so there is nothing to backfill and a default would be a
-- claim about a screen that did not exist. Deliberately not a new value
-- on `order_source`: that enum answers "how did this reach us" (by hand,
-- by CSV, by API, by an admin) and a v2 order is still MANUAL by that
-- reckoning. Widening it would make every existing reader's exhaustive
-- switch wrong about orders that arrived exactly as they always had.
ALTER TABLE "orders" ADD COLUMN "created_via" TEXT;

-- One address, as Solustation Address judged it.
--
-- KEYED ON THE DRAFT, NOT THE ORDER. The page mints `reference_id` when
-- it opens and the first check can happen minutes before anything is
-- saved, so a row keyed on `order_id` could not hold the thing it exists
-- to record. The order id arrives later, or never: an abandoned form
-- leaves a judgement with no order, which is honest and is also the only
-- way to see how often operators give up at the address step.
--
-- `reference_id` is their BILLING key — one unit per reference per month
-- — which is why the page keeps it in sessionStorage instead of minting
-- a fresh one per mount. A refresh mid-order must not bill twice.
--
-- The vendor's words (`status`, `action`, `po_confidence`) are TEXT, not
-- enums. A Postgres enum would make the day they add a fourth
-- `recommended_action` the day existing rows stop being readable, with
-- the failure arriving at every reader at once and far from its cause.
CREATE TABLE "address_checks" (
    "id"                         UUID        NOT NULL DEFAULT uuidv7(),
    "reference_id"               TEXT        NOT NULL,
    "order_id"                   UUID,
    "seller_id"                  UUID        NOT NULL,
    "store_id"                   UUID,
    "created_by_actor_type"      "actor_type" NOT NULL,
    "created_by_actor_id"        UUID        NOT NULL,
    "validation_id"              TEXT,
    "status"                     TEXT        NOT NULL,
    "action"                     TEXT,
    "score"                      INTEGER,
    "po_confidence"              TEXT,
    "result"                     JSONB,
    "checked_at"                 TIMESTAMPTZ,
    "attempts"                   INTEGER     NOT NULL DEFAULT 0,
    "next_retry_at"              TIMESTAMPTZ,
    "last_error"                 TEXT,
    "last_request_id"            TEXT,
    "override_actor_type"        "actor_type",
    "override_actor_id"          UUID,
    "override_reason"            TEXT,
    "overridden_at"              TIMESTAMPTZ,
    "confirmed_with_customer_at" TIMESTAMPTZ,
    "feedback_watermark_at"      TIMESTAMPTZ,
    "created_at"                 TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"                 TIMESTAMPTZ NOT NULL,
    CONSTRAINT "address_checks_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "address_checks_reference_id_key" ON "address_checks"("reference_id");
-- One check per order, and the join the feedback sweep walks.
CREATE UNIQUE INDEX "address_checks_order_id_key" ON "address_checks"("order_id");
-- The retry worklist: unavailable checks whose turn has come.
CREATE INDEX "address_checks_status_next_retry_at_idx" ON "address_checks"("status", "next_retry_at");
-- The feedback sweep, oldest watermark first.
CREATE INDEX "address_checks_feedback_watermark_at_idx" ON "address_checks"("feedback_watermark_at");
CREATE INDEX "address_checks_seller_id_created_at_idx" ON "address_checks"("seller_id", "created_at");

-- CASCADE on the order: a deleted order's address judgement is about
-- nothing. (Orders are soft-deleted in practice, so this is the hard
-- -delete path only.) The order side is nullable, so a draft that never
-- became an order simply keeps its row.
ALTER TABLE "address_checks"
    ADD CONSTRAINT "address_checks_order_id_fkey"
    FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
