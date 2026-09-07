-- A seller's SHOPFRONTS.
--
-- One seller, many brands. Catalog, stock, wallet and courier accounts
-- stay per SELLER — the goods are the same goods on the same shelf, and
-- splitting stock per store would leave one brand unable to sell while
-- its sibling has forty units idle in the same bin. So a store is an
-- attribute of an ORDER: which shopfront this sale came from.

CREATE TABLE "seller_stores" (
    "id"         UUID NOT NULL DEFAULT uuidv7(),
    "seller_id"  UUID NOT NULL,
    "name"       TEXT NOT NULL,
    "note"       TEXT,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "is_active"  BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,
    "deleted_at" TIMESTAMPTZ,

    CONSTRAINT "seller_stores_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "seller_stores_seller_id_name_key"
  ON "seller_stores" ("seller_id", "name");
CREATE INDEX "seller_stores_seller_id_is_active_idx"
  ON "seller_stores" ("seller_id", "is_active");

-- EXACTLY ONE DEFAULT PER SELLER, and made unrepresentable rather than
-- validated: two tabs both promoting a default would otherwise both
-- succeed under READ COMMITTED, and order create would then have two
-- defaults to choose between. Prisma cannot express a partial unique,
-- so this index exists only here — see the schema comment.
CREATE UNIQUE INDEX "seller_stores_one_default_per_seller"
  ON "seller_stores" ("seller_id")
  WHERE "is_default" AND "deleted_at" IS NULL;

ALTER TABLE "seller_stores"
  ADD CONSTRAINT "seller_stores_seller_id_fkey"
    FOREIGN KEY ("seller_id") REFERENCES "sellers"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- ── ORDERS ───────────────────────────────────────────────────────────
-- Added nullable, backfilled, then made NOT NULL. Every seller gets a
-- default store in the same transaction that creates them from here on,
-- so there is never again a moment when an order has no store to belong
-- to — and a nullable column would push a null check through every
-- reader to express something that cannot happen.
ALTER TABLE "orders" ADD COLUMN "store_id" UUID;
ALTER TABLE "orders" ADD COLUMN "store_name_snapshot" TEXT;

ALTER TABLE "seller_users" ADD COLUMN "store_id" UUID;

-- Every existing seller gets their default shopfront.
INSERT INTO "seller_stores" ("seller_id", "name", "is_default", "is_active", "updated_at")
SELECT s."id", 'Default store', true, true, CURRENT_TIMESTAMP
FROM "sellers" s;

-- And every order they have ever placed belongs to it. The NAME is
-- snapshotted, not joined: renaming the store later must not rewrite
-- what a past customer was told (ORD-6).
UPDATE "orders" o
SET "store_id" = st."id",
    "store_name_snapshot" = st."name"
FROM "seller_stores" st
WHERE st."seller_id" = o."seller_id" AND st."is_default";

ALTER TABLE "orders" ALTER COLUMN "store_id" SET NOT NULL;
ALTER TABLE "orders" ALTER COLUMN "store_name_snapshot" SET NOT NULL;

ALTER TABLE "orders"
  ADD CONSTRAINT "orders_store_id_fkey"
    FOREIGN KEY ("store_id") REFERENCES "seller_stores"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "seller_users"
  ADD CONSTRAINT "seller_users_store_id_fkey"
    FOREIGN KEY ("store_id") REFERENCES "seller_stores"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "orders_store_id_idx" ON "orders" ("store_id");
-- The query every filtered list actually makes.
CREATE INDEX "orders_seller_id_store_id_status_idx"
  ON "orders" ("seller_id", "store_id", "status");
CREATE INDEX "seller_users_store_id_idx" ON "seller_users" ("store_id");

-- ── THE IDEMPOTENCY KEY MOVES TO THE STORE ───────────────────────────
-- Two shopfronts each running their own Shopify will BOTH produce order
-- `#1001`. Under the old seller-wide key, the second one did not fail —
-- CSV import is idempotent on that pair (ORD-9), so it silently PATCHED
-- the first store's order. That is data corruption, not an
-- inconvenience, and it only becomes reachable the moment a seller has
-- a second store.
DROP INDEX IF EXISTS "orders_seller_id_seller_order_ref_key";
CREATE UNIQUE INDEX "orders_seller_id_store_id_seller_order_ref_key"
  ON "orders" ("seller_id", "store_id", "seller_order_ref");
