-- R3 (revised-plan roadmap) — BD→India inbound freight billing.
--
-- Fully additive: a new table plus one new wallet direction. Existing
-- goods receipts simply have no freight bill until ops records one.
--
-- NOTE on the enum value: `ALTER TYPE ... ADD VALUE` is safe inside a
-- migration transaction on PG12+ as long as the new value is not USED in
-- the same migration — it is not (the first inbound_freight entry can
-- only be written at runtime).

CREATE TYPE "inbound_freight_mode" AS ENUM (
  'pay_now',
  'pay_later'
);

CREATE TYPE "inbound_freight_status" AS ENUM (
  'pending',
  'settled',
  'waived'
);

ALTER TYPE "wallet_entry_direction" ADD VALUE 'inbound_freight';

CREATE TABLE "inbound_freight_charges" (
  "id"                     UUID NOT NULL DEFAULT uuidv7(),
  "seller_id"              UUID NOT NULL,
  "goods_receipt_id"       UUID NOT NULL,
  "amount_inr"             DECIMAL(12,2) NOT NULL,
  "mode"                   "inbound_freight_mode" NOT NULL,
  "service_charge_percent" DECIMAL(5,2),
  "service_charge_inr"     DECIMAL(12,2),
  "total_inr"              DECIMAL(12,2) NOT NULL,
  "status"                 "inbound_freight_status" NOT NULL DEFAULT 'pending',
  "settled_at"             TIMESTAMPTZ,
  "settled_by_staff_id"    UUID,
  "wallet_entry_id"        UUID,
  "note"                   TEXT,
  "created_at"             TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"             TIMESTAMPTZ NOT NULL,

  CONSTRAINT "inbound_freight_charges_pkey" PRIMARY KEY ("id")
);

-- One bill per consignment: the unique index IS the "record" idempotency
-- gate, not just a data-quality nicety.
CREATE UNIQUE INDEX "inbound_freight_charges_goods_receipt_id_key"
  ON "inbound_freight_charges" ("goods_receipt_id");

-- One settlement debit per bill — the wallet entry is the evidence the
-- seller was charged exactly once.
CREATE UNIQUE INDEX "inbound_freight_charges_wallet_entry_id_key"
  ON "inbound_freight_charges" ("wallet_entry_id");

CREATE INDEX "inbound_freight_charges_seller_id_status_idx"
  ON "inbound_freight_charges" ("seller_id", "status");
CREATE INDEX "inbound_freight_charges_status_idx"
  ON "inbound_freight_charges" ("status");
CREATE INDEX "inbound_freight_charges_settled_by_staff_id_idx"
  ON "inbound_freight_charges" ("settled_by_staff_id");

ALTER TABLE "inbound_freight_charges"
  ADD CONSTRAINT "inbound_freight_charges_seller_id_fkey"
  FOREIGN KEY ("seller_id") REFERENCES "sellers" ("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "inbound_freight_charges"
  ADD CONSTRAINT "inbound_freight_charges_goods_receipt_id_fkey"
  FOREIGN KEY ("goods_receipt_id") REFERENCES "goods_receipts" ("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "inbound_freight_charges"
  ADD CONSTRAINT "inbound_freight_charges_settled_by_staff_id_fkey"
  FOREIGN KEY ("settled_by_staff_id") REFERENCES "staff_users" ("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "inbound_freight_charges"
  ADD CONSTRAINT "inbound_freight_charges_wallet_entry_id_fkey"
  FOREIGN KEY ("wallet_entry_id") REFERENCES "seller_wallet_entries" ("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
