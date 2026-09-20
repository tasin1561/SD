-- Void-and-re-bill, which FRT-6 offers and the database refused.
--
-- `inbound_freight_charges.goods_receipt_id` and
-- `inbound_freight_allocations.goods_receipt_line_id` were both
-- UNCONDITIONALLY unique, and the void deliberately KEEPS its rows as the
-- record of what was billed. So a withdrawn bill blocked its own
-- replacement at two levels: a mistyped PAY_NOW bill left that shipment's
-- freight permanently uncollectable, and a mistyped PAY_ADVANCE bill left
-- the goods unable to leave Bangladesh at all (FREIGHT_ADVANCE_NOT_BILLED).
--
-- Both uniques become PARTIAL, on live rows only — the same shape as
-- `inbound_freight_one_advance_per_consignment`, which Prisma cannot
-- express either. The allocation gets its OWN `voided_at` because an index
-- predicate cannot reach the charge's through a join, and because every
-- reader of a line's allocation then has one local column to filter on.

-- The allocation's own liveness flag.
ALTER TABLE "inbound_freight_allocations" ADD COLUMN "voided_at" TIMESTAMPTZ;

-- An allocation belonging to an ALREADY-voided bill is dead too. No rows
-- match today (nothing has been voided — the feature ships in this same
-- change), but a void landing between deploy steps must not leave a live
-- allocation behind a dead bill. An UPDATE, not an INSERT, so there is no
-- `updated_at` to supply: the rows already carry one.
UPDATE "inbound_freight_allocations" a
   SET "voided_at" = c."voided_at"
  FROM "inbound_freight_charges" c
 WHERE a."freight_charge_id" = c."id"
   AND c."voided_at" IS NOT NULL;

-- DropIndex
DROP INDEX "inbound_freight_charges_goods_receipt_id_key";

-- DropIndex
DROP INDEX "inbound_freight_allocations_goods_receipt_line_id_key";

-- CreateIndex
CREATE INDEX "inbound_freight_charges_goods_receipt_id_idx" ON "inbound_freight_charges"("goods_receipt_id");

-- CreateIndex
CREATE INDEX "inbound_freight_allocations_goods_receipt_line_id_idx" ON "inbound_freight_allocations"("goods_receipt_line_id");

-- The uniques that replace them: one LIVE bill per arrival, one LIVE
-- allocation per line. A withdrawn bill sits beside its replacement and
-- constrains nothing, which is what "void and re-bill" means.
CREATE UNIQUE INDEX "inbound_freight_one_live_bill_per_receipt"
    ON "inbound_freight_charges" ("goods_receipt_id")
 WHERE "voided_at" IS NULL;

CREATE UNIQUE INDEX "inbound_freight_one_live_allocation_per_line"
    ON "inbound_freight_allocations" ("goods_receipt_line_id")
 WHERE "voided_at" IS NULL;
