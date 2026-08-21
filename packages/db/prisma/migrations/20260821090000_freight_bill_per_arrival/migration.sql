-- Inbound freight: one bill per ARRIVAL, not per consignment.
--
-- `consignment_id UNIQUE` assumed a consignment arrives once. It does
-- not — 300 units can leave Dhaka as 100 now and 200 in September — and
-- under the old key both billing choices lost money silently: bill early
-- and later arrivals get no allocation row (the charge path skips a unit
-- with no allocation, so they ship freight-free forever, and the second
-- forwarder invoice cannot be entered at all); bill late and units that
-- sold before the bill existed are never charged.
--
-- Safe as a NOT NULL add: inbound_freight_charges is empty in every
-- environment (verified on production, 0 rows, 0 allocations).

-- DROP INDEX, not DROP CONSTRAINT: Prisma emits `@unique` as
-- `CREATE UNIQUE INDEX "<table>_<col>_key"`, so there is no constraint
-- of that name to drop. Written as DROP CONSTRAINT IF EXISTS first,
-- which `IF EXISTS` turned into a silent no-op — the unique survived and
-- CI's drift gate caught it. A DROP you EXPECT to succeed should not
-- carry IF EXISTS; it converts a loud failure into a quiet wrong result.
DROP INDEX IF EXISTS "inbound_freight_charges_consignment_id_key";

ALTER TABLE "inbound_freight_charges"
  ADD COLUMN "goods_receipt_id" UUID NOT NULL;

CREATE UNIQUE INDEX "inbound_freight_charges_goods_receipt_id_key"
  ON "inbound_freight_charges"("goods_receipt_id");

CREATE INDEX "inbound_freight_charges_consignment_id_idx"
  ON "inbound_freight_charges"("consignment_id");

ALTER TABLE "inbound_freight_charges"
  ADD CONSTRAINT "inbound_freight_charges_goods_receipt_id_fkey"
  FOREIGN KEY ("goods_receipt_id") REFERENCES "goods_receipts"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
