-- Split `customers.manage` out of `customers.view`.
--
-- The seller customer endpoints gated the EDIT and the SOFT DELETE on
-- `customers.view`, the read permission. A company could therefore not
-- express "let them look at customers": the only way to withhold the
-- write was to withhold the read, so any role granted "See customers"
-- could also rename and remove customer records.
--
-- The guard is fail-closed (SellerJwtGuard rule 4), so without this
-- backfill the new permission would exist and nobody would hold it —
-- every existing seller would lose the ability to edit a customer at
-- the moment of deploy.
--
-- WHO GETS IT. A role that holds `customers.view` AND at least one
-- genuine write permission was already editing customers and keeps
-- doing so — that is every default `admin` and `ops` role, which is who
-- this was always meant for. A role holding `customers.view` and NO
-- other write is one somebody built to be read-only, and it does NOT
-- get the write back. That is the hole, and closing it is the point;
-- an owner who disagrees can grant it on the roles screen in a click.
--
-- The `owner` role is deliberately absent: `isOwner` grants every
-- permission implicitly, including ones added after it was created, so
-- there is nothing to backfill there.
--
-- Guarded with NOT EXISTS rather than ON CONFLICT: the unique key
-- includes the nullable `scope`, and Postgres treats NULLs as distinct
-- by default, so ON CONFLICT would not fire for the rows this actually
-- writes (scope is NULL for every one of them today).
INSERT INTO seller_role_permissions (role_id, permission, scope)
SELECT
  r.id,
  'customers.manage',
  p.scope
FROM seller_roles r
JOIN seller_role_permissions p
  ON p.role_id = r.id AND p.permission = 'customers.view'
WHERE r.is_owner = FALSE
  AND EXISTS (
    SELECT 1
    FROM seller_role_permissions w
    WHERE w.role_id = r.id
      AND w.permission IN (
        'orders.create',
        'orders.cancel',
        'orders.import',
        'orders.pending.manage',
        'catalog.manage',
        'catalog.import',
        'recipient_addresses.manage'
      )
  )
  AND NOT EXISTS (
    SELECT 1
    FROM seller_role_permissions existing
    WHERE existing.role_id = r.id
      AND existing.permission = 'customers.manage'
  );
