-- RS-5 — reseller store ORDERS (docs/reseller-stores.md "Store orders as
-- built"). Orders placed by a reseller store belong to the SELLER (stock,
-- warehouse, courier, WMS unchanged) and carry the store's terms AS PLACED.
--
-- What this does to EXISTING rows:
--   - orders: every row gets store_kind = 'channel' (the default). Phase 1
--     refused to file any order under a reseller store (STORE_IS_RESELLER),
--     so every existing order sits on a channel store; the guard below
--     STOPS the migration if that is somehow untrue rather than guessing.
--     Their snapshot columns stay NULL, which is exactly what the CHECK
--     requires of a channel order.
--   - order_items: nothing to backfill; new columns stay NULL.
--   - customers: every row keeps reseller_store_id NULL (the seller's own
--     customer). The (seller_id, phone_e164) unique is REPLACED by a
--     partial unique over exactly those rows, so every existing row stays
--     valid and stays unique on the same key.
--   - bulk_order_uploads / seller_webhook_endpoints: new nullable column,
--     NULL = the seller's own, as before.
--   - store roles: the five new store permissions are granted to existing
--     stores' system roles (the owner holds everything implicitly).
--   - system_settings: `reseller.orders_enabled`, OFF.

-- ── 0. Guard: no order may already sit on a reseller store ────────────
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "orders" o
    JOIN "seller_stores" s ON s."id" = o."store_id"
    WHERE s."kind" <> 'channel'
  ) THEN
    RAISE EXCEPTION 'RS-5: an order is already filed under a reseller store; resolve it before this migration (store orders did not exist yet)';
  END IF;
END $$;

-- ── 1. seller_stores: (id, kind) is the target of the orders FK ────────
CREATE UNIQUE INDEX "seller_stores_id_kind_key" ON "seller_stores"("id", "kind");

-- ── 2. orders ─────────────────────────────────────────────────────────
ALTER TABLE "orders"
  ADD COLUMN "store_kind" "seller_store_kind" NOT NULL DEFAULT 'channel',
  ADD COLUMN "reseller_terms_version_id" UUID,
  ADD COLUMN "reseller_delivery_fee_store_percent" DECIMAL(5,2),
  ADD COLUMN "reseller_return_fee_store_percent" DECIMAL(5,2),
  ADD COLUMN "reseller_customer_return_fee_store_percent" DECIMAL(5,2),
  ADD COLUMN "reseller_cod_fee_store_percent" DECIMAL(5,2),
  ADD COLUMN "reseller_cod_tax_store_percent" DECIMAL(5,2),
  ADD COLUMN "reseller_instant_pay_fee_store_percent" DECIMAL(5,2),
  ADD COLUMN "reseller_store_credit_trigger" "reseller_credit_trigger",
  ADD COLUMN "reseller_store_credit_days" INTEGER,
  ADD COLUMN "reseller_seller_credit_trigger" "reseller_credit_trigger",
  ADD COLUMN "reseller_seller_credit_days" INTEGER;

-- The order's store FK becomes composite: an order's kind IS its store's
-- kind, by construction. Same actions as the constraint it replaces.
ALTER TABLE "orders" DROP CONSTRAINT "orders_store_id_fkey";
ALTER TABLE "orders"
  ADD CONSTRAINT "orders_store_id_store_kind_fkey"
    FOREIGN KEY ("store_id", "store_kind") REFERENCES "seller_stores"("id", "kind")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "orders"
  ADD CONSTRAINT "orders_reseller_terms_version_id_fkey"
    FOREIGN KEY ("reseller_terms_version_id") REFERENCES "reseller_store_terms_versions"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "orders_reseller_terms_version_id_idx" ON "orders"("reseller_terms_version_id");

-- A reseller order carries EVERY snapshot column; a channel order NONE.
-- The phase-1 CHECK style: two shapes, and nothing half-way between them.
ALTER TABLE "orders" ADD CONSTRAINT "orders_reseller_snapshot_ck" CHECK (
  (
    "store_kind" = 'channel'
    AND "reseller_terms_version_id" IS NULL
    AND "reseller_delivery_fee_store_percent" IS NULL
    AND "reseller_return_fee_store_percent" IS NULL
    AND "reseller_customer_return_fee_store_percent" IS NULL
    AND "reseller_cod_fee_store_percent" IS NULL
    AND "reseller_cod_tax_store_percent" IS NULL
    AND "reseller_instant_pay_fee_store_percent" IS NULL
    AND "reseller_store_credit_trigger" IS NULL
    AND "reseller_store_credit_days" IS NULL
    AND "reseller_seller_credit_trigger" IS NULL
    AND "reseller_seller_credit_days" IS NULL
  )
  OR
  (
    "store_kind" = 'reseller'
    AND "reseller_terms_version_id" IS NOT NULL
    AND "reseller_delivery_fee_store_percent" BETWEEN 0 AND 100
    AND "reseller_return_fee_store_percent" BETWEEN 0 AND 100
    AND "reseller_customer_return_fee_store_percent" BETWEEN 0 AND 100
    AND "reseller_cod_fee_store_percent" BETWEEN 0 AND 100
    AND "reseller_cod_tax_store_percent" BETWEEN 0 AND 100
    AND "reseller_instant_pay_fee_store_percent" BETWEEN 0 AND 100
    AND "reseller_store_credit_trigger" IS NOT NULL
    AND "reseller_store_credit_days" BETWEEN 0 AND 365
    AND "reseller_seller_credit_trigger" IS NOT NULL
    AND "reseller_seller_credit_days" BETWEEN 0 AND 365
  )
);

-- ── 3. order_items: a reseller line's terms as placed ─────────────────
ALTER TABLE "order_items"
  ADD COLUMN "reseller_transfer_price_inr" DECIMAL(12,2),
  ADD COLUMN "reseller_retail_unit_inr" DECIMAL(12,2),
  ADD COLUMN "reseller_min_retail_inr" DECIMAL(12,2),
  ADD COLUMN "reseller_max_retail_inr" DECIMAL(12,2),
  ADD COLUMN "reseller_stock_mode" "reseller_stock_mode";

ALTER TABLE "order_items" ADD CONSTRAINT "order_items_reseller_snapshot_ck" CHECK (
  (
    "reseller_transfer_price_inr" IS NULL
    AND "reseller_retail_unit_inr" IS NULL
    AND "reseller_min_retail_inr" IS NULL
    AND "reseller_max_retail_inr" IS NULL
    AND "reseller_stock_mode" IS NULL
  )
  OR
  (
    "reseller_transfer_price_inr" > 0
    AND "reseller_retail_unit_inr" >= 0
    AND "reseller_stock_mode" IS NOT NULL
    AND ("reseller_min_retail_inr" IS NULL OR "reseller_retail_unit_inr" >= "reseller_min_retail_inr")
    AND ("reseller_max_retail_inr" IS NULL OR "reseller_retail_unit_inr" <= "reseller_max_retail_inr")
  )
);

-- ── 4. customers: identity per OWNER (ORD-7 generalised) ──────────────
ALTER TABLE "customers" ADD COLUMN "reseller_store_id" UUID;

ALTER TABLE "customers"
  ADD CONSTRAINT "customers_reseller_store_id_fkey"
    FOREIGN KEY ("reseller_store_id") REFERENCES "seller_stores"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "customers_reseller_store_id_idx" ON "customers"("reseller_store_id");

-- The seller-wide unique is replaced by one per owner. Every existing row
-- has reseller_store_id NULL, so it lands in the first index on the SAME
-- key it had before — nothing becomes a duplicate.
DROP INDEX "customers_seller_id_phone_e164_key";
CREATE UNIQUE INDEX "customers_seller_phone_own_uq"
  ON "customers"("seller_id", "phone_e164") WHERE "reseller_store_id" IS NULL;
CREATE UNIQUE INDEX "customers_store_phone_uq"
  ON "customers"("reseller_store_id", "phone_e164") WHERE "reseller_store_id" IS NOT NULL;

-- ── 5. bulk_order_uploads: a store's CSV uploads ──────────────────────
ALTER TABLE "bulk_order_uploads"
  ADD COLUMN "reseller_store_id" UUID,
  ADD COLUMN "uploaded_by_store_user_id" UUID;

ALTER TABLE "bulk_order_uploads"
  ADD CONSTRAINT "bulk_order_uploads_reseller_store_id_fkey"
    FOREIGN KEY ("reseller_store_id") REFERENCES "seller_stores"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "bulk_order_uploads_reseller_store_id_idx" ON "bulk_order_uploads"("reseller_store_id");

-- ── 6. seller_webhook_endpoints: a store's own endpoints ──────────────
ALTER TABLE "seller_webhook_endpoints" ADD COLUMN "reseller_store_id" UUID;

ALTER TABLE "seller_webhook_endpoints"
  ADD CONSTRAINT "seller_webhook_endpoints_reseller_store_id_fkey"
    FOREIGN KEY ("reseller_store_id") REFERENCES "seller_stores"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "seller_webhook_endpoints_reseller_store_id_idx"
  ON "seller_webhook_endpoints"("reseller_store_id");

-- ── 7. store_api_keys ─────────────────────────────────────────────────
CREATE TABLE "store_api_keys" (
  "id" UUID NOT NULL DEFAULT uuidv7(),
  "store_id" UUID NOT NULL,
  "seller_id" UUID NOT NULL,
  "name" TEXT NOT NULL,
  "key_prefix" TEXT NOT NULL,
  "key_hash" TEXT NOT NULL,
  "created_by_store_user_id" UUID,
  "last_used_at" TIMESTAMPTZ,
  "expires_at" TIMESTAMPTZ,
  "revoked_at" TIMESTAMPTZ,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ NOT NULL,
  "deleted_at" TIMESTAMPTZ,

  CONSTRAINT "store_api_keys_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "store_api_keys_key_hash_key" ON "store_api_keys"("key_hash");
CREATE INDEX "store_api_keys_store_id_idx" ON "store_api_keys"("store_id");

ALTER TABLE "store_api_keys"
  ADD CONSTRAINT "store_api_keys_store_id_fkey"
    FOREIGN KEY ("store_id") REFERENCES "seller_stores"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- ── 8. Store permissions for existing stores' system roles ────────────
-- Same shape as the RS-3 / RS-4 grants. The owner role holds everything
-- implicitly and needs no row. New stores get these from
-- provisionDefaultStoreRoles (DEFAULT_STORE_ROLES).
INSERT INTO "store_role_permissions" ("id", "role_id", "permission", "granted_at")
SELECT uuidv7(), r."id", p."permission", CURRENT_TIMESTAMP
FROM "store_roles" r
JOIN (
  VALUES
    ('admin', 'orders.view'),
    ('admin', 'orders.create'),
    ('admin', 'orders.cancel'),
    ('admin', 'customers.view'),
    ('admin', 'integrations.manage'),
    ('ops', 'orders.view'),
    ('ops', 'orders.create'),
    ('ops', 'orders.cancel'),
    ('ops', 'customers.view'),
    ('finance', 'orders.view'),
    ('finance', 'customers.view'),
    ('viewer', 'orders.view')
) AS p("role_key", "permission") ON p."role_key" = r."key"
WHERE r."is_system" = true AND r."deleted_at" IS NULL
ON CONFLICT ("role_id", "permission") DO NOTHING;

-- ── 9. The master switch — OFF until the money (phase 3c) is wired ─────
-- Without 3c a delivered reseller order would credit the SELLER the whole
-- COD (the existing path knows nothing of the store's share). So store
-- orders are refused (`RESELLER_ORDERS_DISABLED`) until this is on.
-- Seller-overridable (SET-1): Skydrop may switch it on per seller from the
-- seller's settings; the global row is editable by admin too.
INSERT INTO "system_settings" (
  "id", "key", "category", "value_type", "value_boolean",
  "display_name", "description",
  "is_editable_by_admin", "is_sensitive", "seller_overridable",
  "created_at", "updated_at"
)
VALUES (
  uuidv7(),
  'reseller.orders_enabled',
  'reseller',
  'boolean',
  false,
  'Reseller stores — accept store orders',
  'Whether this seller''s reseller stores may place orders. OFF until the reseller money (fee split at each party''s credit trigger, prepaid debit, reversals) is live: without it a delivered reseller order would credit the seller the whole COD. Switch on per seller from the seller''s settings.',
  true,
  false,
  true,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
)
ON CONFLICT ("key") DO NOTHING;
