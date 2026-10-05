-- The three ACCESS TIERS the staff catalogue was missing.
--
-- The seven seeded roles are JOB FUNCTIONS (Call agent, Warehouse
-- staff, Finance) and they stay: they encode distinctions a tier ladder
-- cannot — picking versus supervising, who may close a manifest, who
-- may collapse a warehouse's bins. What was missing is the other axis:
-- "everything short of who-has-access", "the support desk", "look but
-- do not touch". Neither axis refines the other, which is why a person
-- may hold several roles (20261005000000_multi_role_per_person) and the
-- guard resolves the UNION.
--
-- ── THESE ROWS ARE GENERATED ────────────────────────────────────────
-- The sets are DERIVED in
-- `apps/api/src/common/auth/staff-role-presets.ts` so a permission
-- added next release lands in the right tiers by construction. SQL
-- cannot import TypeScript, so the derived rows are written out here
-- and `staff-role-presets.spec.ts` compares this file against that
-- constant IN BOTH DIRECTIONS. Editing one without the other fails the
-- build; editing neither is how a tier silently stops meaning what its
-- name says.
--
-- Nothing is granted to anybody: these are roles, waiting to be given.
-- Existing staff members are untouched.

INSERT INTO "staff_roles" ("key", "name", "description", "is_system", "is_super_admin", "updated_at") VALUES
  ('admin',    'Admin',     'Runs the platform: orders, the warehouse, couriers, sellers and the money that moves through it. Not who has access, not our bank accounts or a seller''s, and none of the five overrides that bypass an invariant.', true, false, CURRENT_TIMESTAMP),
  ('support',  'Support',   'Answers for what went wrong: reads orders, parcels, sellers and stores, works the ticket queue, and can open the system-issues page a problem notification points at. Changes nothing operational.',                    true, false, CURRENT_TIMESTAMP),
  ('readonly', 'Read-only', 'Sees everything and changes nothing — every read in the catalogue and no write at all. For an auditor, an analyst, or somebody being shown round.',                                                                     true, false, CURRENT_TIMESTAMP)
ON CONFLICT ("key") DO NOTHING;

INSERT INTO "staff_role_permissions" ("role_id", "permission")
SELECT r."id", p."permission"
FROM "staff_roles" r
JOIN (VALUES
  ('admin', 'orders.view'),
  ('admin', 'orders.cancel'),
  ('admin', 'orders.charges.view'),
  ('admin', 'orders.charges.compute'),
  ('admin', 'orders.courier_choice'),
  ('admin', 'orders.tracking.run_poll'),
  ('admin', 'orders.tracking.manual_scan'),
  ('admin', 'callcenter.work'),
  ('admin', 'callcenter.queue.view'),
  ('admin', 'callcenter.queue.manage'),
  ('admin', 'callcenter.agents.manage'),
  ('admin', 'warehouse.view'),
  ('admin', 'warehouse.manage'),
  ('admin', 'warehouse.pick'),
  ('admin', 'warehouse.pack'),
  ('admin', 'warehouse.pick.supervise'),
  ('admin', 'notifications.broadcast'),
  ('admin', 'warehouse.labels.reprint'),
  ('admin', 'warehouse.manifest.close'),
  ('admin', 'warehouse.rto.receive'),
  ('admin', 'warehouse.rto.inspect'),
  ('admin', 'warehouse.rto.finalize'),
  ('admin', 'warehouse.rto.putaway'),
  ('admin', 'inventory.view'),
  ('admin', 'inventory.adjustments.create'),
  ('admin', 'inventory.adjustments.approve'),
  ('admin', 'inventory.cycle_counts.manage'),
  ('admin', 'inventory.goods_receipts.manage'),
  ('admin', 'inventory.transfers.manage'),
  ('admin', 'courier.dispatch.handoff'),
  ('admin', 'courier.manual_placement'),
  ('admin', 'courier.accounts.view'),
  ('admin', 'courier.accounts.manage'),
  ('admin', 'courier.ops.view'),
  ('admin', 'courier.ops.write'),
  ('admin', 'courier.pickups.manage'),
  ('admin', 'courier.margin.view'),
  ('admin', 'courier.waybills.manage'),
  ('admin', 'sellers.view'),
  ('admin', 'sellers.approve'),
  ('admin', 'sellers.suspend'),
  ('admin', 'sellers.invite'),
  ('admin', 'sellers.settings.manage'),
  ('admin', 'sellers.courier_links.manage'),
  ('admin', 'sellers.notes.manage'),
  ('admin', 'reseller.stores.view'),
  ('admin', 'reseller.stores.manage'),
  ('admin', 'reseller.stores.pause'),
  ('admin', 'leads.view'),
  ('admin', 'leads.manage'),
  ('admin', 'money.view'),
  ('admin', 'money.wallets.reconcile'),
  ('admin', 'money.wallets.bill_unbilled'),
  ('admin', 'money.topups.review'),
  ('admin', 'money.withdrawals.review'),
  ('admin', 'money.remittances.manage'),
  ('admin', 'money.settlements.record'),
  ('admin', 'money.freight.manage'),
  ('admin', 'money.treasury.view'),
  ('admin', 'money.treasury.manage'),
  ('admin', 'money.pnl.close'),
  ('admin', 'pricing.preview'),
  ('admin', 'fx.view'),
  ('admin', 'fx.manage'),
  ('admin', 'tickets.view'),
  ('admin', 'tickets.resolve'),
  ('admin', 'holds.manage'),
  ('admin', 'reports.view'),
  ('admin', 'webhooks.view'),
  ('admin', 'webhooks.retry'),
  ('admin', 'system.settings.view'),
  ('admin', 'system.settings.manage'),
  ('admin', 'system.capacity.view'),
  ('support', 'orders.view'),
  ('support', 'tickets.view'),
  ('support', 'tickets.resolve'),
  ('support', 'courier.ops.view'),
  ('support', 'warehouse.view'),
  ('support', 'sellers.view'),
  ('support', 'reseller.stores.view'),
  ('support', 'callcenter.queue.view'),
  ('support', 'system.settings.view'),
  ('readonly', 'orders.view'),
  ('readonly', 'orders.charges.view'),
  ('readonly', 'callcenter.queue.view'),
  ('readonly', 'warehouse.view'),
  ('readonly', 'inventory.view'),
  ('readonly', 'courier.accounts.view'),
  ('readonly', 'courier.ops.view'),
  ('readonly', 'courier.margin.view'),
  ('readonly', 'sellers.view'),
  ('readonly', 'reseller.stores.view'),
  ('readonly', 'leads.view'),
  ('readonly', 'money.view'),
  ('readonly', 'money.treasury.view'),
  ('readonly', 'fx.view'),
  ('readonly', 'tickets.view'),
  ('readonly', 'reports.view'),
  ('readonly', 'webhooks.view'),
  ('readonly', 'system.settings.view'),
  ('readonly', 'system.capacity.view'),
  ('readonly', 'staff.view')
) AS p("role_key", "permission") ON p."role_key" = r."key"
-- NOT EXISTS rather than ON CONFLICT: the unique index covers
-- `scope`, which is NULL on every row here, and Postgres treats
-- NULLs as distinct — so ON CONFLICT would never fire and a re-run
-- would double the rows.
WHERE NOT EXISTS (
  SELECT 1 FROM "staff_role_permissions" x
  WHERE x."role_id" = r."id" AND x."permission" = p."permission" AND x."scope" IS NULL
);
