-- RS-3 (2026-09-14) — reseller stores, phase 2: catalogue, prices, stock.
-- docs/reseller-stores.md "Phase 2 as built".
--
-- WHAT THIS DOES TO EXISTING ROWS: nothing is rewritten. Four tables and
-- one enum are NEW. The only writes to existing data are two GRANTS:
--   (a) every existing reseller store's admin / ops / finance / viewer
--       role gains `catalogue.view` (the owner holds every store
--       permission implicitly) — what `provisionDefaultStoreRoles` gives a
--       store created from now on;
--   (b) every seller's system 'admin' role that already holds
--       `stores.manage` gains `stores.pricing` (phase 1 registered it as
--       reserved; this release gives it endpoints). A company whose admins
--       were not trusted with reseller stores is left exactly as it was;
--       the owner holds it implicitly either way.
-- Both are INSERT … WHERE NOT EXISTS, so a re-run adds nothing.
-- No TimescaleDB object is created or altered (no compression settings).

-- CreateEnum
CREATE TYPE "reseller_stock_mode" AS ENUM ('shared', 'set_aside');

-- CreateTable
CREATE TABLE "reseller_price_list_items" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "seller_id" UUID NOT NULL,
    "variant_id" UUID NOT NULL,
    "transfer_price_inr" DECIMAL(12,2) NOT NULL,
    "min_retail_inr" DECIMAL(12,2),
    "max_retail_inr" DECIMAL(12,2),
    "suggested_retail_inr" DECIMAL(12,2),
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "reseller_price_list_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reseller_store_variants" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "store_id" UUID NOT NULL,
    "seller_id" UUID NOT NULL,
    "variant_id" UUID NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "transfer_price_inr" DECIMAL(12,2),
    "min_retail_inr" DECIMAL(12,2),
    "max_retail_inr" DECIMAL(12,2),
    "suggested_retail_inr" DECIMAL(12,2),
    "stock_mode" "reseller_stock_mode" NOT NULL DEFAULT 'shared',
    "set_aside_qty" INTEGER,
    "set_aside_at" TIMESTAMPTZ,
    "hidden_percent" INTEGER NOT NULL DEFAULT 0,
    "overlay_title" TEXT,
    "overlay_description" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "reseller_store_variants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reseller_store_variant_images" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "store_variant_id" UUID NOT NULL,
    "storage_key" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ,

    CONSTRAINT "reseller_store_variant_images_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reseller_set_aside_shrinks" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "store_variant_id" UUID NOT NULL,
    "store_id" UUID NOT NULL,
    "seller_id" UUID NOT NULL,
    "variant_id" UUID NOT NULL,
    "from_qty" INTEGER NOT NULL,
    "to_qty" INTEGER NOT NULL,
    "on_hand" INTEGER NOT NULL,
    "total_before" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reseller_set_aside_shrinks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "reseller_price_list_items_variant_id_idx" ON "reseller_price_list_items"("variant_id");

-- CreateIndex
CREATE UNIQUE INDEX "reseller_price_list_items_seller_id_variant_id_key" ON "reseller_price_list_items"("seller_id", "variant_id");

-- CreateIndex
CREATE INDEX "reseller_store_variants_seller_id_variant_id_idx" ON "reseller_store_variants"("seller_id", "variant_id");

-- CreateIndex
CREATE INDEX "reseller_store_variants_variant_id_idx" ON "reseller_store_variants"("variant_id");

-- CreateIndex
CREATE UNIQUE INDEX "reseller_store_variants_store_id_variant_id_key" ON "reseller_store_variants"("store_id", "variant_id");

-- CreateIndex
CREATE INDEX "reseller_store_variant_images_store_variant_id_idx" ON "reseller_store_variant_images"("store_variant_id");

-- CreateIndex
CREATE INDEX "reseller_set_aside_shrinks_store_id_created_at_idx" ON "reseller_set_aside_shrinks"("store_id", "created_at");

-- CreateIndex
CREATE INDEX "reseller_set_aside_shrinks_seller_id_created_at_idx" ON "reseller_set_aside_shrinks"("seller_id", "created_at");

-- AddForeignKey
ALTER TABLE "reseller_price_list_items" ADD CONSTRAINT "reseller_price_list_items_seller_id_fkey" FOREIGN KEY ("seller_id") REFERENCES "sellers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reseller_price_list_items" ADD CONSTRAINT "reseller_price_list_items_variant_id_fkey" FOREIGN KEY ("variant_id") REFERENCES "product_variants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reseller_store_variants" ADD CONSTRAINT "reseller_store_variants_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "seller_stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reseller_store_variants" ADD CONSTRAINT "reseller_store_variants_seller_id_fkey" FOREIGN KEY ("seller_id") REFERENCES "sellers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reseller_store_variants" ADD CONSTRAINT "reseller_store_variants_variant_id_fkey" FOREIGN KEY ("variant_id") REFERENCES "product_variants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reseller_store_variant_images" ADD CONSTRAINT "reseller_store_variant_images_store_variant_id_fkey" FOREIGN KEY ("store_variant_id") REFERENCES "reseller_store_variants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reseller_set_aside_shrinks" ADD CONSTRAINT "reseller_set_aside_shrinks_store_variant_id_fkey" FOREIGN KEY ("store_variant_id") REFERENCES "reseller_store_variants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ── CHECKs: what Prisma cannot express, and what makes a bad row ─────
-- unrepresentable rather than merely refused by the service.

-- A default price row: transfer > 0; retail figures ≥ 0 and ordered
-- min ≤ suggested ≤ max wherever set.
ALTER TABLE "reseller_price_list_items" ADD CONSTRAINT "reseller_price_list_items_amounts_ck" CHECK (
  "transfer_price_inr" > 0
  AND ("min_retail_inr" IS NULL OR "min_retail_inr" >= 0)
  AND ("max_retail_inr" IS NULL OR "max_retail_inr" >= 0)
  AND ("suggested_retail_inr" IS NULL OR "suggested_retail_inr" >= 0)
  AND ("min_retail_inr" IS NULL OR "max_retail_inr" IS NULL OR "min_retail_inr" <= "max_retail_inr")
  AND ("suggested_retail_inr" IS NULL OR "min_retail_inr" IS NULL OR "min_retail_inr" <= "suggested_retail_inr")
  AND ("suggested_retail_inr" IS NULL OR "max_retail_inr" IS NULL OR "suggested_retail_inr" <= "max_retail_inr")
);

-- A store's override is a WHOLE row or nothing: no retail figure without
-- a transfer price, and the same amount rules as a default row.
ALTER TABLE "reseller_store_variants" ADD CONSTRAINT "reseller_store_variants_override_ck" CHECK (
  (
    "transfer_price_inr" IS NULL
    AND "min_retail_inr" IS NULL
    AND "max_retail_inr" IS NULL
    AND "suggested_retail_inr" IS NULL
  )
  OR (
    "transfer_price_inr" > 0
    AND ("min_retail_inr" IS NULL OR "min_retail_inr" >= 0)
    AND ("max_retail_inr" IS NULL OR "max_retail_inr" >= 0)
    AND ("suggested_retail_inr" IS NULL OR "suggested_retail_inr" >= 0)
    AND ("min_retail_inr" IS NULL OR "max_retail_inr" IS NULL OR "min_retail_inr" <= "max_retail_inr")
    AND ("suggested_retail_inr" IS NULL OR "min_retail_inr" IS NULL OR "min_retail_inr" <= "suggested_retail_inr")
    AND ("suggested_retail_inr" IS NULL OR "max_retail_inr" IS NULL OR "suggested_retail_inr" <= "max_retail_inr")
  )
);

-- SHARED carries no quantity; SET_ASIDE carries one, zero or more.
ALTER TABLE "reseller_store_variants" ADD CONSTRAINT "reseller_store_variants_stock_mode_ck" CHECK (
  ("stock_mode" = 'shared' AND "set_aside_qty" IS NULL)
  OR ("stock_mode" = 'set_aside' AND "set_aside_qty" IS NOT NULL AND "set_aside_qty" >= 0)
);

-- A store is never shown less than a tenth of what it could be.
ALTER TABLE "reseller_store_variants" ADD CONSTRAINT "reseller_store_variants_hidden_percent_ck" CHECK (
  "hidden_percent" >= 0 AND "hidden_percent" <= 90
);

-- A shrink only ever takes away, and never below zero.
ALTER TABLE "reseller_set_aside_shrinks" ADD CONSTRAINT "reseller_set_aside_shrinks_qty_ck" CHECK (
  "to_qty" >= 0 AND "to_qty" < "from_qty"
);

-- ── GRANTS (see the header) ───────────────────────────────────────────

-- (a) catalogue.view for every existing reseller store's non-owner roles.
INSERT INTO "store_role_permissions" ("role_id", "permission")
SELECT r."id", 'catalogue.view'
FROM "store_roles" r
WHERE r."key" IN ('admin', 'ops', 'finance', 'viewer')
  AND r."deleted_at" IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM "store_role_permissions" p
    WHERE p."role_id" = r."id" AND p."permission" = 'catalogue.view'
  );

-- (b) stores.pricing for seller admin roles already trusted with stores.manage.
INSERT INTO "seller_role_permissions" ("role_id", "permission")
SELECT r."id", 'stores.pricing'
FROM "seller_roles" r
WHERE r."key" = 'admin'
  AND r."is_system" = true
  AND r."deleted_at" IS NULL
  AND EXISTS (
    SELECT 1 FROM "seller_role_permissions" m
    WHERE m."role_id" = r."id" AND m."permission" = 'stores.manage'
  )
  AND NOT EXISTS (
    SELECT 1 FROM "seller_role_permissions" p
    WHERE p."role_id" = r."id" AND p."permission" = 'stores.pricing'
  );
