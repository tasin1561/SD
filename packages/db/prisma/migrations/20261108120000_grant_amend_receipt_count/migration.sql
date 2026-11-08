-- inventory.goods_receipts.amend_count: overwrite the counted quantity on a
-- consignment leg that is still ARRIVING.
--
-- A new key reaches no EXISTING role without a backfill, and super admin
-- needs none (`is_super_admin` expands to every key). Granted to:
--   * admin -- the access tier derives every non-withheld key, so the
--     constant already holds it and the live rows must agree.
--   * warehouse_supervisor -- the floor's escalation point; already holds
--     inventory.goods_receipts.manage and the stock adjustments.
-- Deliberately NOT warehouse_staff: the person doing the count must not be
-- the one who can rewrite it afterwards.
--
-- The grant lives HERE and not in 20261005000100_staff_access_tier_roles,
-- even though that file carries the rest of the Admin tier. That migration
-- has already been applied in production, and Prisma stores a checksum per
-- applied migration: editing the file makes `migrate deploy` fail on the
-- next deploy. An applied migration is history and history does not change.
-- `staff-role-presets.spec.ts` therefore reads the tier file AND every
-- later migration, so a key added after the tiers were seeded is granted
-- here and still proves it matches the preset constant.
--
-- The `JOIN (VALUES ...)` shape is deliberate: it is the shape the tier
-- migration uses, so ONE parser in that spec reads both files.
INSERT INTO "staff_role_permissions" ("role_id", "permission")
SELECT r."id", v.permission
FROM "staff_roles" r
JOIN (VALUES
  ('admin', 'inventory.goods_receipts.amend_count'),
  ('warehouse_supervisor', 'inventory.goods_receipts.amend_count')
) AS v(role_key, permission) ON v.role_key = r."key"
-- NOT EXISTS rather than ON CONFLICT: `scope` is NULL and the unique
-- index treats NULLs as distinct (see 20261005000100).
WHERE NOT EXISTS (
  SELECT 1 FROM "staff_role_permissions" x
  WHERE x."role_id" = r."id"
    AND x."permission" = v.permission
    AND x."scope" IS NULL
);
