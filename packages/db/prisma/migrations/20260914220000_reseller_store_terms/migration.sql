-- RS-4 (2026-09-14) — reseller store TERMS: who pays which Skydrop fee,
-- when each party is credited, versioned and accepted by the store.
-- docs/reseller-stores.md "Terms as built".
--
-- WHAT THIS DOES TO EXISTING ROWS: nothing is altered. Two tables and
-- one enum type are new. Two data statements follow the DDL:
--   1. every EXISTING reseller store's system roles gain the two new
--      store permissions (terms.view / terms.accept), exactly as
--      `provisionDefaultStoreRoles` now grants them to a new store —
--      production has no reseller store yet, so today this inserts
--      nothing; it is here so the day it runs on a database that has
--      some, those stores are not left with roles that cannot see or
--      accept their own terms;
--   2. the `reseller.credit_after_confirmation_enabled` setting row,
--      because the deploy runs migrations and the seed is create-only.
-- No TimescaleDB object is created or altered (no compression settings).

-- CreateEnum
CREATE TYPE "reseller_credit_trigger" AS ENUM ('on_payout', 'after_delivery', 'instant', 'after_confirmation');

-- CreateTable
CREATE TABLE "reseller_store_terms_versions" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "store_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "delivery_fee_store_percent" DECIMAL(5,2) NOT NULL,
    "return_fee_store_percent" DECIMAL(5,2) NOT NULL,
    "customer_return_fee_store_percent" DECIMAL(5,2) NOT NULL,
    "cod_fee_store_percent" DECIMAL(5,2) NOT NULL,
    "cod_tax_store_percent" DECIMAL(5,2) NOT NULL,
    "instant_pay_fee_store_percent" DECIMAL(5,2) NOT NULL,
    "store_credit_trigger" "reseller_credit_trigger" NOT NULL,
    "store_credit_days" INTEGER NOT NULL,
    "seller_credit_trigger" "reseller_credit_trigger" NOT NULL,
    "seller_credit_days" INTEGER NOT NULL,
    "note" TEXT,
    "created_by_actor_type" "actor_type" NOT NULL,
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reseller_store_terms_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reseller_store_terms_acceptances" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "store_id" UUID NOT NULL,
    "terms_version_id" UUID NOT NULL,
    "store_user_id" UUID NOT NULL,
    "accepted_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ip_address" INET,
    "user_agent" TEXT,

    CONSTRAINT "reseller_store_terms_acceptances_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "reseller_store_terms_versions_store_id_created_at_idx" ON "reseller_store_terms_versions"("store_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "reseller_store_terms_versions_store_id_version_key" ON "reseller_store_terms_versions"("store_id", "version");

-- CreateIndex
CREATE UNIQUE INDEX "reseller_store_terms_versions_id_store_id_key" ON "reseller_store_terms_versions"("id", "store_id");

-- CreateIndex
CREATE UNIQUE INDEX "reseller_store_terms_acceptances_terms_version_id_key" ON "reseller_store_terms_acceptances"("terms_version_id");

-- CreateIndex
CREATE INDEX "reseller_store_terms_acceptances_store_id_accepted_at_idx" ON "reseller_store_terms_acceptances"("store_id", "accepted_at");

-- CreateIndex
CREATE INDEX "reseller_store_terms_acceptances_store_user_id_idx" ON "reseller_store_terms_acceptances"("store_user_id");

-- AddForeignKey
ALTER TABLE "reseller_store_terms_versions" ADD CONSTRAINT "reseller_store_terms_versions_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "seller_stores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reseller_store_terms_acceptances" ADD CONSTRAINT "reseller_store_terms_acceptances_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "seller_stores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reseller_store_terms_acceptances" ADD CONSTRAINT "reseller_store_terms_acceptances_terms_version_id_store_id_fkey" FOREIGN KEY ("terms_version_id", "store_id") REFERENCES "reseller_store_terms_versions"("id", "store_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reseller_store_terms_acceptances" ADD CONSTRAINT "reseller_store_terms_acceptances_store_user_id_fkey" FOREIGN KEY ("store_user_id") REFERENCES "store_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ── CHECKs Prisma cannot express ─────────────────────────────────────
-- Each share is a percent the STORE pays, 0–100 (the seller pays the
-- rest). The service validates the same bounds; this is what makes a
-- share outside them unrepresentable rather than merely unlikely.
ALTER TABLE "reseller_store_terms_versions" ADD CONSTRAINT "reseller_store_terms_versions_percents_ck" CHECK (
  "delivery_fee_store_percent" BETWEEN 0 AND 100
  AND "return_fee_store_percent" BETWEEN 0 AND 100
  AND "customer_return_fee_store_percent" BETWEEN 0 AND 100
  AND "cod_fee_store_percent" BETWEEN 0 AND 100
  AND "cod_tax_store_percent" BETWEEN 0 AND 100
  AND "instant_pay_fee_store_percent" BETWEEN 0 AND 100
);

-- Days are 0–365; INSTANT (at delivery) takes none; AFTER_DELIVERY takes
-- at least one (zero days after delivery IS instant, which carries the
-- Instant Pay fee — `terms-rules.ts` explains).
ALTER TABLE "reseller_store_terms_versions" ADD CONSTRAINT "reseller_store_terms_versions_timing_ck" CHECK (
  "store_credit_days" BETWEEN 0 AND 365
  AND "seller_credit_days" BETWEEN 0 AND 365
  AND ("store_credit_trigger" <> 'instant' OR "store_credit_days" = 0)
  AND ("seller_credit_trigger" <> 'instant' OR "seller_credit_days" = 0)
  AND ("store_credit_trigger" <> 'after_delivery' OR "store_credit_days" >= 1)
  AND ("seller_credit_trigger" <> 'after_delivery' OR "seller_credit_days" >= 1)
);

ALTER TABLE "reseller_store_terms_versions" ADD CONSTRAINT "reseller_store_terms_versions_version_ck" CHECK ("version" >= 1);

-- ── The two new store permissions, for stores that already exist ─────
-- Mirrors DEFAULT_STORE_ROLES: admin holds every key; ops, finance and
-- viewer may see the terms. The owner role holds everything implicitly
-- and needs no row. ON CONFLICT on the (role_id, permission) unique.
INSERT INTO "store_role_permissions" ("id", "role_id", "permission", "granted_at")
SELECT uuidv7(), r."id", 'terms.view', CURRENT_TIMESTAMP
FROM "store_roles" r
WHERE r."is_system" = true AND r."deleted_at" IS NULL
  AND r."key" IN ('admin', 'ops', 'finance', 'viewer')
ON CONFLICT ("role_id", "permission") DO NOTHING;

INSERT INTO "store_role_permissions" ("id", "role_id", "permission", "granted_at")
SELECT uuidv7(), r."id", 'terms.accept', CURRENT_TIMESTAMP
FROM "store_roles" r
WHERE r."is_system" = true AND r."deleted_at" IS NULL
  AND r."key" = 'admin'
ON CONFLICT ("role_id", "permission") DO NOTHING;

-- ── The per-seller switch (decision 10) ──────────────────────────────
-- OFF by default. `is_editable_by_admin = false` on purpose: the GLOBAL
-- row must not be flippable from /settings, which would switch it on for
-- every seller at once. It is turned on per seller only, as a
-- seller_setting_overrides row written through the dedicated endpoint
-- (POST /admin/sellers/:sellerId/reseller-credit-after-confirmation,
-- `reseller.credit_after_confirmation.enable`). ON CONFLICT DO NOTHING:
-- a row the seed already made (dev, CI) keeps whatever it holds.
INSERT INTO "system_settings" (
  "id", "key", "category", "value_type", "value_boolean",
  "display_name", "description",
  "is_editable_by_admin", "is_sensitive", "seller_overridable",
  "created_at", "updated_at"
)
VALUES (
  uuidv7(),
  'reseller.credit_after_confirmation_enabled',
  'reseller',
  'boolean',
  false,
  'Reseller stores — allow credit after confirmation',
  'Whether this seller''s reseller-store terms may credit a party N days after the order is confirmed on the phone — money fronted before the customer has paid. Off by default. Turned on per seller only, by Skydrop, on the seller''s page (it needs the "Allow credit after confirmation for a seller" permission); the global value is not editable. Switching it off never rewrites a store''s terms: new versions using it are refused, and stores whose current version uses it are flagged until the seller publishes a new one.',
  false,
  false,
  true,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
)
ON CONFLICT ("key") DO NOTHING;
