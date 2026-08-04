-- Seller roles become DATA, scoped per company.
--
-- `seller_user_role` was a Postgres enum with six values, and five of
-- them saw EVERYTHING — they differed only in what they could change.
-- There was no way for a company to say "this person handles inbound
-- stock and must not see the wallet", which is the ordinary case for
-- anyone with staff.
--
-- Roles now live in `seller_roles`, keyed by (seller_id, key) because
-- one company's "Manager" has nothing to do with another's. The
-- permission KEYS they grant stay in code
-- (apps/api/src/common/auth/seller-permissions.ts), because a line of
-- code checks each one.
--
-- INERT ON DEPLOY: the six defaults reproduce what the enum did, every
-- existing member is backfilled onto the matching row, and the legacy
-- column stays until the guard is switched over.
--
-- The role and permission lists below are GENERATED from that
-- catalogue rather than typed out; `seller-default-roles.spec.ts`
-- re-derives them and fails if the two ever disagree.

CREATE TABLE "seller_roles" (
    "id"          UUID        NOT NULL DEFAULT uuidv7(),
    "seller_id"   UUID        NOT NULL,
    "key"         TEXT        NOT NULL,
    "name"        TEXT        NOT NULL,
    "description" TEXT,
    "is_system"   BOOLEAN     NOT NULL DEFAULT false,
    "is_owner"    BOOLEAN     NOT NULL DEFAULT false,
    "created_at"  TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"  TIMESTAMPTZ NOT NULL,
    "deleted_at"  TIMESTAMPTZ,
    CONSTRAINT "seller_roles_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "seller_roles_seller_id_key_key" ON "seller_roles"("seller_id", "key");
CREATE INDEX "seller_roles_seller_id_idx" ON "seller_roles"("seller_id");
ALTER TABLE "seller_roles"
    ADD CONSTRAINT "seller_roles_seller_id_fkey"
    FOREIGN KEY ("seller_id") REFERENCES "sellers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "seller_role_permissions" (
    "id"         UUID        NOT NULL DEFAULT uuidv7(),
    "role_id"    UUID        NOT NULL,
    "permission" TEXT        NOT NULL,
    "scope"      TEXT,
    "granted_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "seller_role_permissions_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "seller_role_permissions_role_permission_scope_key"
    ON "seller_role_permissions"("role_id", "permission", "scope");
CREATE INDEX "seller_role_permissions_role_id_idx" ON "seller_role_permissions"("role_id");
ALTER TABLE "seller_role_permissions"
    ADD CONSTRAINT "seller_role_permissions_role_id_fkey"
    FOREIGN KEY ("role_id") REFERENCES "seller_roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ── The six defaults, for EVERY existing seller ─────────────────────
INSERT INTO "seller_roles" ("seller_id", "key", "name", "description", "is_system", "is_owner", "updated_at")
SELECT s."id", d."key", d."name", d."description", true, d."is_owner", CURRENT_TIMESTAMP
FROM "sellers" s
CROSS JOIN (VALUES
  ('owner', 'Owner', 'Everything, including permissions added later. Cannot be edited or deleted.', true),
  ('admin', 'Admin', 'Everything except managing roles.', false),
  ('ops', 'Operations', 'Orders, the catalogue and stock. No money, no team.', false),
  ('inventory', 'Inventory', 'Stock and inbound consignments, and the catalogue behind them.', false),
  ('finance', 'Finance', 'The wallet, payouts, charges and freight.', false),
  ('viewer', 'Viewer', 'Read-only, and only the orders. The narrowest login there is.', false)
) AS d("key", "name", "description", "is_owner");

-- The owner role gets NO rows: `is_owner` grants everything implicitly,
-- so a permission added next release reaches it with no backfill.
INSERT INTO "seller_role_permissions" ("role_id", "permission")
SELECT r."id", d."permission"
FROM "seller_roles" r
JOIN (VALUES
  ('admin', 'orders.view'),
  ('admin', 'orders.create'),
  ('admin', 'orders.cancel'),
  ('admin', 'orders.import'),
  ('admin', 'orders.pending.manage'),
  ('admin', 'customers.view'),
  ('admin', 'recipient_addresses.manage'),
  ('admin', 'catalog.view'),
  ('admin', 'catalog.manage'),
  ('admin', 'catalog.import'),
  ('admin', 'inventory.view'),
  ('admin', 'inbound.view'),
  ('admin', 'inbound.manage'),
  ('admin', 'holds.manage'),
  ('admin', 'wallet.view'),
  ('admin', 'wallet.topup'),
  ('admin', 'wallet.withdraw'),
  ('admin', 'charges.view'),
  ('admin', 'freight.view'),
  ('admin', 'tickets.view'),
  ('admin', 'tickets.create'),
  ('admin', 'profile.view'),
  ('admin', 'profile.manage'),
  ('admin', 'addresses.manage'),
  ('admin', 'team.view'),
  ('admin', 'team.manage'),
  ('admin', 'api_keys.manage'),
  ('admin', 'webhooks.manage'),
  ('admin', 'notifications.manage'),
  ('ops', 'orders.view'),
  ('ops', 'orders.create'),
  ('ops', 'orders.cancel'),
  ('ops', 'orders.import'),
  ('ops', 'orders.pending.manage'),
  ('ops', 'customers.view'),
  ('ops', 'recipient_addresses.manage'),
  ('ops', 'catalog.view'),
  ('ops', 'catalog.manage'),
  ('ops', 'catalog.import'),
  ('ops', 'inventory.view'),
  ('ops', 'inbound.view'),
  ('ops', 'holds.manage'),
  ('ops', 'tickets.view'),
  ('ops', 'tickets.create'),
  ('ops', 'profile.view'),
  ('ops', 'addresses.manage'),
  ('inventory', 'orders.view'),
  ('inventory', 'catalog.view'),
  ('inventory', 'catalog.manage'),
  ('inventory', 'catalog.import'),
  ('inventory', 'inventory.view'),
  ('inventory', 'inbound.view'),
  ('inventory', 'inbound.manage'),
  ('inventory', 'holds.manage'),
  ('inventory', 'tickets.view'),
  ('inventory', 'tickets.create'),
  ('inventory', 'profile.view'),
  ('inventory', 'addresses.manage'),
  ('finance', 'orders.view'),
  ('finance', 'charges.view'),
  ('finance', 'wallet.view'),
  ('finance', 'wallet.topup'),
  ('finance', 'wallet.withdraw'),
  ('finance', 'freight.view'),
  ('finance', 'tickets.view'),
  ('finance', 'profile.view'),
  ('finance', 'profile.manage'),
  ('finance', 'notifications.manage'),
  ('viewer', 'orders.view')
) AS d("role_key", "permission") ON d."role_key" = r."key";

-- ── Backfill every team member ──────────────────────────────────────
ALTER TABLE "seller_users" ADD COLUMN "role_id" UUID;

UPDATE "seller_users" u
SET "role_id" = r."id"
FROM "seller_roles" r
WHERE r."seller_id" = u."seller_id" AND r."key" = u."role"::text;

DO $$
DECLARE orphans INT;
BEGIN
  SELECT COUNT(*) INTO orphans FROM "seller_users" WHERE "role_id" IS NULL;
  IF orphans > 0 THEN
    RAISE EXCEPTION 'seller_users backfill left % row(s) without a role', orphans;
  END IF;
END $$;

ALTER TABLE "seller_users" ALTER COLUMN "role_id" SET NOT NULL;
CREATE INDEX "seller_users_role_id_idx" ON "seller_users"("role_id");
ALTER TABLE "seller_users"
    ADD CONSTRAINT "seller_users_role_id_fkey"
    FOREIGN KEY ("role_id") REFERENCES "seller_roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
