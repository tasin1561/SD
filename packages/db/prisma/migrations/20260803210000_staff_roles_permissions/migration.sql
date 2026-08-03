-- Staff roles become DATA.
--
-- `staff_role` was a Postgres enum, so creating a role meant a migration
-- and a deploy. It is replaced by `staff_roles` rows an admin can create,
-- rename and delete, each holding a bundle of permission KEYS that stay
-- defined in code (apps/api/src/common/auth/permissions.ts) because a
-- line of code checks each one.
--
-- This migration is DELIBERATELY INERT: it adds the tables, seeds the
-- seven existing roles with the permissions their names already imply,
-- and backfills every staff member onto the matching row. The legacy
-- `staff_users.role` column stays authoritative until the permission
-- guard replaces it, so nothing changes on deploy.

CREATE TABLE "staff_roles" (
    "id"             UUID         NOT NULL DEFAULT uuidv7(),
    "key"            TEXT         NOT NULL,
    "name"           TEXT         NOT NULL,
    "description"    TEXT,
    "is_system"      BOOLEAN      NOT NULL DEFAULT false,
    "is_super_admin" BOOLEAN      NOT NULL DEFAULT false,
    "created_at"     TIMESTAMPTZ  NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"     TIMESTAMPTZ  NOT NULL,
    "deleted_at"     TIMESTAMPTZ,
    CONSTRAINT "staff_roles_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "staff_roles_key_key" ON "staff_roles"("key");

CREATE TABLE "staff_role_permissions" (
    "id"         UUID        NOT NULL DEFAULT uuidv7(),
    "role_id"    UUID        NOT NULL,
    "permission" TEXT        NOT NULL,
    "scope"      TEXT,
    "granted_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "staff_role_permissions_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "staff_role_permissions_role_permission_scope_key"
    ON "staff_role_permissions"("role_id", "permission", "scope");
CREATE INDEX "staff_role_permissions_role_id_idx" ON "staff_role_permissions"("role_id");

ALTER TABLE "staff_role_permissions"
    ADD CONSTRAINT "staff_role_permissions_role_id_fkey"
    FOREIGN KEY ("role_id") REFERENCES "staff_roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ── The seven existing roles ────────────────────────────────────────
-- `key` keeps the enum's spelling so the backfill below is a straight
-- join on the old value.
INSERT INTO "staff_roles" ("key", "name", "description", "is_system", "is_super_admin", "updated_at") VALUES
  ('super_admin',            'Super admin',            'Everything, including future permissions. Cannot be edited or deleted.', true, true,  CURRENT_TIMESTAMP),
  ('seller_approval_admin',  'Seller approval admin',  'Lets sellers into the platform and works the invite queue.',             true, false, CURRENT_TIMESTAMP),
  ('call_agent',             'Call agent',             'Works the call queue and confirms COD orders by phone.',                  true, false, CURRENT_TIMESTAMP),
  ('warehouse_staff',        'Warehouse staff',        'Picks, packs and receives returns on the floor.',                         true, false, CURRENT_TIMESTAMP),
  ('warehouse_supervisor',   'Warehouse supervisor',   'The floor, plus manifests, stock corrections and return dispositions.',   true, false, CURRENT_TIMESTAMP),
  ('manual_placement_admin', 'Manual placement admin', 'Places parcels the courier refused, and acts on parcels at the courier.', true, false, CURRENT_TIMESTAMP),
  ('finance',                'Finance',                'Wallets, payouts, settlements and freight.',                              true, false, CURRENT_TIMESTAMP);

-- Super admin gets NO rows: `is_super_admin` grants every permission
-- implicitly, so a permission added next month reaches it without a
-- backfill anyone has to remember.

INSERT INTO "staff_role_permissions" ("role_id", "permission")
SELECT r."id", p."permission"
FROM "staff_roles" r
JOIN (VALUES
  -- Seller approval admin
  ('seller_approval_admin', 'sellers.view'),
  ('seller_approval_admin', 'sellers.approve'),
  ('seller_approval_admin', 'sellers.suspend'),
  ('seller_approval_admin', 'sellers.invite'),
  ('seller_approval_admin', 'sellers.notes.manage'),
  ('seller_approval_admin', 'leads.view'),
  ('seller_approval_admin', 'leads.manage'),

  -- Call agent: their own station, and the orders they are calling about.
  ('call_agent', 'callcenter.work'),
  ('call_agent', 'orders.view'),

  -- Warehouse staff: the floor.
  ('warehouse_staff', 'orders.view'),
  ('warehouse_staff', 'inventory.view'),
  ('warehouse_staff', 'warehouse.view'),
  ('warehouse_staff', 'warehouse.pick'),
  ('warehouse_staff', 'warehouse.pack'),
  ('warehouse_staff', 'warehouse.rto.receive'),
  ('warehouse_staff', 'warehouse.rto.inspect'),
  ('warehouse_staff', 'warehouse.rto.putaway'),

  -- Warehouse supervisor: the floor, plus everything it escalates to.
  -- NOT warehouse.bins.collapse — BIN-4 keeps that to super admin.
  ('warehouse_supervisor', 'orders.view'),
  ('warehouse_supervisor', 'inventory.view'),
  ('warehouse_supervisor', 'warehouse.view'),
  ('warehouse_supervisor', 'warehouse.pick'),
  ('warehouse_supervisor', 'warehouse.pack'),
  ('warehouse_supervisor', 'warehouse.rto.receive'),
  ('warehouse_supervisor', 'warehouse.rto.inspect'),
  ('warehouse_supervisor', 'warehouse.rto.putaway'),
  ('warehouse_supervisor', 'warehouse.manage'),
  ('warehouse_supervisor', 'warehouse.pick.supervise'),
  ('warehouse_supervisor', 'warehouse.manifest.close'),
  ('warehouse_supervisor', 'warehouse.rto.finalize'),
  ('warehouse_supervisor', 'inventory.adjustments.create'),
  ('warehouse_supervisor', 'inventory.adjustments.approve'),
  ('warehouse_supervisor', 'inventory.cycle_counts.manage'),
  ('warehouse_supervisor', 'inventory.goods_receipts.manage'),
  ('warehouse_supervisor', 'inventory.transfers.manage'),
  ('warehouse_supervisor', 'courier.dispatch.handoff'),
  ('warehouse_supervisor', 'courier.pickups.manage'),
  ('warehouse_supervisor', 'courier.ops.view'),
  ('warehouse_supervisor', 'courier.waybills.manage'),
  ('warehouse_supervisor', 'orders.tracking.manual_scan'),

  -- Manual placement admin: the parcels the API could not place.
  ('manual_placement_admin', 'orders.view'),
  ('manual_placement_admin', 'courier.manual_placement'),
  ('manual_placement_admin', 'courier.ops.view'),
  ('manual_placement_admin', 'courier.ops.write'),
  ('manual_placement_admin', 'courier.waybills.manage'),
  ('manual_placement_admin', 'orders.tracking.manual_scan'),

  -- Finance.
  ('finance', 'sellers.view'),
  ('finance', 'orders.view'),
  ('finance', 'orders.charges.view'),
  ('finance', 'sellers.bank_account.reveal'),
  ('finance', 'money.view'),
  ('finance', 'money.topups.review'),
  ('finance', 'money.withdrawals.review'),
  ('finance', 'money.remittances.manage'),
  ('finance', 'money.settlements.record'),
  ('finance', 'money.freight.manage'),
  ('finance', 'money.bank_accounts.manage'),
  ('finance', 'pricing.preview'),
  ('finance', 'fx.view'),
  ('finance', 'reports.view')
) AS p("role_key", "permission") ON p."role_key" = r."key";

-- ── Backfill ────────────────────────────────────────────────────────
-- Nullable first, filled from the enum, then made required: a NOT NULL
-- column added to a populated table has to arrive in that order.
ALTER TABLE "staff_users" ADD COLUMN "role_id" UUID;

UPDATE "staff_users" u
SET "role_id" = r."id"
FROM "staff_roles" r
WHERE r."key" = u."role"::text;

-- Nobody is left behind: if this fires, a staff row holds an enum value
-- with no matching seeded role, and continuing would mean guessing.
DO $$
DECLARE orphans INT;
BEGIN
  SELECT COUNT(*) INTO orphans FROM "staff_users" WHERE "role_id" IS NULL;
  IF orphans > 0 THEN
    RAISE EXCEPTION 'staff_users backfill left % row(s) without a role', orphans;
  END IF;
END $$;

ALTER TABLE "staff_users" ALTER COLUMN "role_id" SET NOT NULL;

CREATE INDEX "staff_users_role_id_idx" ON "staff_users"("role_id");

ALTER TABLE "staff_users"
    ADD CONSTRAINT "staff_users_role_id_fkey"
    FOREIGN KEY ("role_id") REFERENCES "staff_roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
