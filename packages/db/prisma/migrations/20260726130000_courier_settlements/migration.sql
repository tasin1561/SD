-- R2c — record every rupee the courier pays US, and match it to orders.
--
-- The missing half of the COD loop. Delhivery collects cash from the
-- customer on delivery and settles with Skydrop 5-10 days later; nothing
-- recorded that inbound payment, so "have we actually been paid for the
-- orders we already credited sellers for?" could not be answered. These
-- two tables make the float and any short-payment countable.

CREATE TABLE "courier_settlements" (
  "id"                   UUID NOT NULL DEFAULT uuidv7(),
  "courier_account_id"   UUID NOT NULL,
  "reference"            TEXT NOT NULL,
  "amount_inr"           DECIMAL(14,2) NOT NULL,
  "allocated_inr"        DECIMAL(14,2) NOT NULL DEFAULT 0,
  "received_at"          TIMESTAMPTZ NOT NULL,
  "recorded_by_staff_id" UUID,
  "note"                 TEXT,
  "created_at"           TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"           TIMESTAMPTZ NOT NULL,

  CONSTRAINT "courier_settlements_pkey" PRIMARY KEY ("id")
);

-- The courier's own payout reference, unique per account: the gate against
-- recording the same bank credit twice.
CREATE UNIQUE INDEX "courier_settlements_courier_account_id_reference_key"
  ON "courier_settlements" ("courier_account_id", "reference");
CREATE INDEX "courier_settlements_courier_account_id_received_at_idx"
  ON "courier_settlements" ("courier_account_id", "received_at");
CREATE INDEX "courier_settlements_received_at_idx"
  ON "courier_settlements" ("received_at");
CREATE INDEX "courier_settlements_recorded_by_staff_id_idx"
  ON "courier_settlements" ("recorded_by_staff_id");

ALTER TABLE "courier_settlements"
  ADD CONSTRAINT "courier_settlements_courier_account_id_fkey"
  FOREIGN KEY ("courier_account_id") REFERENCES "courier_accounts" ("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "courier_settlements"
  ADD CONSTRAINT "courier_settlements_recorded_by_staff_id_fkey"
  FOREIGN KEY ("recorded_by_staff_id") REFERENCES "staff_users" ("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "courier_settlement_lines" (
  "id"            UUID NOT NULL DEFAULT uuidv7(),
  "settlement_id" UUID NOT NULL,
  "order_id"      UUID NOT NULL,
  -- Snapshotted at allocation time so (settled - expected) stays a
  -- permanent record of the short-payment for this order.
  "expected_inr"  DECIMAL(12,2) NOT NULL,
  "settled_inr"   DECIMAL(12,2) NOT NULL,
  "note"          TEXT,
  "created_at"    TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "courier_settlement_lines_pkey" PRIMARY KEY ("id")
);

-- One line per order per settlement: a payout cannot pay the same order
-- twice. An order MAY appear across settlements (part-payment then a
-- top-up), so this is deliberately not unique on order_id alone.
CREATE UNIQUE INDEX "courier_settlement_lines_settlement_id_order_id_key"
  ON "courier_settlement_lines" ("settlement_id", "order_id");
CREATE INDEX "courier_settlement_lines_order_id_idx"
  ON "courier_settlement_lines" ("order_id");

ALTER TABLE "courier_settlement_lines"
  ADD CONSTRAINT "courier_settlement_lines_settlement_id_fkey"
  FOREIGN KEY ("settlement_id") REFERENCES "courier_settlements" ("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "courier_settlement_lines"
  ADD CONSTRAINT "courier_settlement_lines_order_id_fkey"
  FOREIGN KEY ("order_id") REFERENCES "orders" ("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
