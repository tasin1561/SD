-- The seller role between Operations and Admin: "Member".
--
-- Operations runs orders and stock and sees no money. Admin is
-- everything short of handing out access. Neither fits the person a
-- seller actually hires first — somebody who places orders, watches the
-- reseller stores, sets what those stores pay, and reads what the
-- company is owed, WITHOUT being able to move money out or let anybody
-- new in. A company that wanted that had to choose between a login too
-- narrow to do the job and one that could empty the wallet.
--
-- ── EVERY EXISTING SELLER, NOT JUST NEW ONES ────────────────────────
-- `provisionDefaultSellerRoles` gives the set to companies created from
-- now on. This is the same set for the companies that already exist —
-- otherwise the role would mean "sellers who signed up after October",
-- which is not a role, it is an accident of timing.
--
-- Nothing is GRANTED to anybody. These are roles waiting to be given,
-- exactly as `20261005000100_staff_access_tier_roles` left the tiers.
--
-- ── THE SET IS DERIVED, AND PINNED ──────────────────────────────────
-- The authority is `DEFAULT_SELLER_ROLES` in
-- `apps/api/src/common/auth/seller-permissions.ts`. SQL cannot import
-- TypeScript, so the keys are written out here and
-- `seller-member-role.spec.ts` compares this file against that constant
-- in BOTH directions: editing one without the other fails the build.
-- Editing neither is how a role quietly stops meaning what its name says.

INSERT INTO "seller_roles" ("seller_id", "key", "name", "description", "is_system", "is_owner", "updated_at")
SELECT s."id",
       'member',
       'Member',
       'Runs the business day to day, including the reseller channel. Everything except changing who can get in, and everything except moving money out.',
       true,
       false,
       CURRENT_TIMESTAMP
FROM "sellers" s
WHERE s."deleted_at" IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM "seller_roles" r
    WHERE r."seller_id" = s."id" AND r."key" = 'member'
  );

INSERT INTO "seller_role_permissions" ("role_id", "permission")
SELECT r."id", p."permission"
FROM "seller_roles" r
CROSS JOIN (VALUES
  ('orders.view'),
  ('orders.create'),
  ('orders.import'),
  ('charges.view'),
  ('wallet.view'),
  ('profile.view'),
  ('tickets.create'),
  ('tickets.view'),
  ('notifications.manage'),
  ('stores.reports'),
  ('stores.wallet'),
  ('stores.order_money.view'),
  ('inventory.view'),
  ('catalog.view'),
  ('stores.pricing')
) AS p("permission")
WHERE r."key" = 'member'
  AND r."deleted_at" IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM "seller_role_permissions" x
    WHERE x."role_id" = r."id" AND x."permission" = p."permission"
  );
