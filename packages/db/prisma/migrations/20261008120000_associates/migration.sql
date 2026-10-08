-- ASSOC-1 — an ASSOCIATE of a reseller store: a person who generates the
-- store's sales, sees only their own orders, and sells at a price the
-- reseller sets.
--
-- ── WHAT THIS IS NOT ────────────────────────────────────────────────
-- Not a tier. An associate is a STORE USER with a narrow role and a
-- scope, so none of the three two-party invariants is touched:
-- RS-4's `splitFee` still has exactly one remainder-holder, TRE-8c's
-- bank invariant still walks one level of store wallets, and RS-3's
-- visible stock is still a set-aside rather than a set-aside inside one.
-- An associate has no wallet; the reseller settles with them outside
-- Skydrop. If that ever changes, it is a different size of project.
--
-- ── THE ENUM IS IN THIS FILE AND USED IN THE NEXT STATEMENT ─────────
-- Postgres refuses to USE a new enum value in the transaction that
-- created the type only for values added to an EXISTING type
-- (ALTER TYPE ... ADD VALUE). A type created here can be referenced
-- here, which is why the column default below is safe.

-- CreateEnum
CREATE TYPE "store_order_scope" AS ENUM ('own', 'all');

-- ── 1. Which orders a role sees ─────────────────────────────────────
-- DEFAULT 'own' so a role added later is narrow until somebody widens
-- it — the fail-closed posture every guard in this codebase takes.
ALTER TABLE "store_roles" ADD COLUMN "order_scope" "store_order_scope" NOT NULL DEFAULT 'own';

-- …and then ALL, EXPLICITLY, for every role that predates associates.
-- Relying on the default would have silently narrowed every existing
-- store login to "only orders I placed myself" — and since no existing
-- order records a store user at all (the column below is new and
-- null-filled), that reads as every store suddenly having no orders.
-- The five seeded keys are named rather than "everything that exists",
-- so a role somebody adds between deploy and this migration is not
-- quietly widened.
UPDATE "store_roles"
   SET "order_scope" = 'all'
 WHERE "key" IN ('owner', 'admin', 'ops', 'finance', 'viewer');

-- ── 2. Who placed an order ──────────────────────────────────────────
-- NULLABLE for ever. Every order placed before this genuinely has no
-- answer, and a backfilled guess would be a claim about who sold
-- something. Null means "no store user placed this" — a seller's own
-- order, staff, a CSV on the seller side — not "unknown".
ALTER TABLE "orders" ADD COLUMN "placed_by_store_user_id" UUID;

ALTER TABLE "orders"
  ADD CONSTRAINT "orders_placed_by_store_user_id_fkey"
  FOREIGN KEY ("placed_by_store_user_id") REFERENCES "store_users"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- The associate's own order list, and the per-associate scorecard, are
-- both "this store user's orders, newest first".
CREATE INDEX "orders_placed_by_store_user_id_created_at_idx"
  ON "orders"("placed_by_store_user_id", "created_at");

-- ── 3. Order creation switched off, per person ──────────────────────
-- RS-1's PAUSED semantics one level down: no NEW orders, everything
-- already placed carries on, and they keep reading and tracking it.
ALTER TABLE "store_users" ADD COLUMN "orders_paused_at" TIMESTAMPTZ;

-- ── 4. What one associate sells one product at ──────────────────────
-- Per associate and set by hand (owner's call): no markup rule and no
-- fallback, so a product with no row here is refused BY NAME rather
-- than priced at something nobody chose.
CREATE TABLE "associate_prices" (
    "id"                  UUID           NOT NULL DEFAULT uuidv7(),
    "store_id"            UUID           NOT NULL,
    "store_user_id"       UUID           NOT NULL,
    "variant_id"          UUID           NOT NULL,
    "retail_price_inr"    DECIMAL(12,2)  NOT NULL,
    "set_by_store_user_id" UUID,
    "created_at"          TIMESTAMPTZ    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"          TIMESTAMPTZ    NOT NULL,
    CONSTRAINT "associate_prices_pkey" PRIMARY KEY ("id")
);

-- One price per associate per product.
CREATE UNIQUE INDEX "associate_prices_store_user_id_variant_id_key"
  ON "associate_prices"("store_user_id", "variant_id");
CREATE INDEX "associate_prices_store_id_idx" ON "associate_prices"("store_id");
CREATE INDEX "associate_prices_variant_id_idx" ON "associate_prices"("variant_id");

ALTER TABLE "associate_prices"
  ADD CONSTRAINT "associate_prices_store_id_fkey"
  FOREIGN KEY ("store_id") REFERENCES "seller_stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "associate_prices"
  ADD CONSTRAINT "associate_prices_store_user_id_fkey"
  FOREIGN KEY ("store_user_id") REFERENCES "store_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "associate_prices"
  ADD CONSTRAINT "associate_prices_variant_id_fkey"
  FOREIGN KEY ("variant_id") REFERENCES "product_variants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ── 5. The two new permission keys, on the roles that already hold ──
--      "everything an owner can do today".
--
-- `DEFAULT_STORE_ROLES` gives `admin` ALL_STORE_PERMISSION_KEYS, which is
-- DERIVED from the catalogue — so the two keys added in this change join
-- it by construction for a store created from here on, and NOT for the
-- stores that already exist. Same shape as RS-6's and RS-8's grants
-- above. The owner needs nothing: it holds every permission implicitly.
INSERT INTO "store_role_permissions" ("role_id", "permission")
SELECT r."id", p."permission"
  FROM "store_roles" r
 CROSS JOIN (VALUES ('catalogue.sell'), ('associates.manage')) AS p("permission")
 WHERE r."key" = 'admin'
ON CONFLICT ("role_id", "permission") DO NOTHING;

-- ── 6. The associate role itself, on every store that already exists ─
-- Provisioned in the same transaction as a new store from here on
-- (`provisionDefaultStoreRoles`); without this, every store created
-- before today would have nobody to invite an associate ONTO, and the
-- feature would read as broken for exactly the stores that have been
-- trading longest.
--
-- `order_scope` is stated rather than left to the column default: the
-- default is what a role gets when nobody decided, and here somebody did.
INSERT INTO "store_roles" ("store_id", "key", "name", "description", "is_system", "is_owner", "order_scope", "updated_at")
SELECT s."id",
       'associate',
       'Associate',
       'Sells for the store. Places orders and follows the ones they placed; never sees another associate''s orders, what the store pays for a product, or the store''s money.',
       TRUE,
       FALSE,
       'own',
       CURRENT_TIMESTAMP
  FROM "seller_stores" s
 WHERE s."kind" = 'reseller'
ON CONFLICT ("store_id", "key") DO NOTHING;

INSERT INTO "store_role_permissions" ("role_id", "permission")
SELECT r."id", p."permission"
  FROM "store_roles" r
 CROSS JOIN (VALUES
     ('store.profile.view'),
     ('catalogue.sell'),
     ('orders.view'),
     ('orders.create'),
     ('orders.cancel'),
     ('orders.actions'),
     ('customers.view'),
     ('tickets.view'),
     ('tickets.manage')
   ) AS p("permission")
 WHERE r."key" = 'associate'
ON CONFLICT ("role_id", "permission") DO NOTHING;
