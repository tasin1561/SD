import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PAGE_PERMISSIONS, canSeePath, permissionForPath } from '@/lib/page-access';

/**
 * The cosmetic route table has to agree with the server.
 *
 * `apps/seller/src/tests/page-access-alignment.test.ts` is the same check
 * for the seller app; this is its permission-shaped twin. Where the table
 * and the API disagree the failure is quiet and late: somebody opens a
 * page that renders perfectly, does the work, and meets a 403 at submit.
 * Three admin pages were in that state — the transfer form (its only
 * write needs `inventory.transfers.manage`) and the pick and pack
 * stations, which inherited `/warehouse`'s READ gate while every call
 * they make needs their own warehouse permission.
 *
 * Three kinds of check:
 *
 *  - STRUCTURAL: a permission string that does not exist at all. These
 *    are hand-typed and a typo fails CLOSED, locking out even the owner.
 *  - REACHABLE: a prefix naming no real route gates nothing, and reads
 *    as protection that is not there.
 *  - PURPOSE: a single-purpose page takes the permission of the
 *    controller it is a screen for, read from the API source rather than
 *    restated here — so a controller's gate moving fails this test
 *    instead of silently leaving the page open to the wrong people.
 */

const API = join(__dirname, '../../../api/src');
const APP = join(__dirname, '../app/(authed)');

/** The class-level `@RequirePermissions` of one controller — what the API
 *  demands of every handler on it that does not narrow further. */
function classGate(relPath: string): string | null {
  const src = readFileSync(join(API, relPath), 'utf8');
  const at = src.indexOf('@Controller(');
  expect(at).toBeGreaterThan(-1);
  const head = src.slice(0, at);
  const perms = [...head.matchAll(/@RequirePermissions\('([^']+)'/g)].map((m) => m[1]);
  return perms.length === 0 ? null : (perms[perms.length - 1] ?? null);
}

describe('every permission this table names is a real one', () => {
  it('matches the API permission catalogue exactly', () => {
    // Read the API source rather than importing it: different app,
    // different tsconfig. Same idiom as the seller table's check and the
    // wallet CREDIT_DIRECTIONS cross-check.
    const src = readFileSync(join(API, 'common/auth/permissions.ts'), 'utf8');
    const known = new Set(Array.from(src.matchAll(/key: '([^']+)'/g), (m) => m[1]));

    // Sanity: if the regex stops matching, every assertion below would
    // pass vacuously against an empty set.
    expect(known.size).toBeGreaterThan(40);

    const unknown = PAGE_PERMISSIONS.map(([, perm]) => perm).filter((p) => !known.has(p));
    expect(unknown).toEqual([]);
  });
});

describe('every prefix gates a page that exists', () => {
  it('names no route that was renamed or never built', () => {
    // A dynamic segment is a directory too, so a prefix ending in one
    // would still resolve — none do today, and a future one should say
    // so here rather than silently matching nothing.
    const missing = PAGE_PERMISSIONS.map(([prefix]) => prefix).filter(
      (prefix) => !existsSync(join(APP, prefix)),
    );
    expect(missing).toEqual([]);
  });
});

describe('a single-purpose page takes the permission of its purpose', () => {
  // page prefix -> the controller it is a screen for. The expectation is
  // the controller's OWN class gate, so this cannot decay into a restated
  // copy of the table it is checking.
  const cases: ReadonlyArray<readonly [path: string, controller: string]> = [
    ['/call-center/queue', 'modules/call-center/controllers/admin-call-queue.controller.ts'],
    ['/call-center/agents', 'modules/call-center/controllers/admin-agent.controller.ts'],
    [
      '/courier-accounts',
      'modules/courier-account-admin/controllers/admin-courier-account.controller.ts',
    ],
    ['/courier-decisions', 'modules/courier-awb/controllers/admin-courier-decision.controller.ts'],
    ['/warehouse/pickups', 'modules/courier-ops/controllers/admin-pickup.controller.ts'],
    [
      '/warehouse/printing',
      'modules/warehouse-printing/controllers/warehouse-printing.controller.ts',
    ],
    ['/warehouse/pick', 'modules/warehouse-pick/controllers/picker.controller.ts'],
    ['/warehouse/pack', 'modules/warehouse-pack/controllers/packer.controller.ts'],
    ['/warehouse/handover', 'modules/courier-dispatch/controllers/dispatch.controller.ts'],
    [
      '/manual-placement',
      'modules/courier-manual-placement/controllers/manual-placement.controller.ts',
    ],
    ['/inventory/transfers', 'modules/inventory-transfer/admin-stock-transfer.controller.ts'],
    [
      '/wallet-transfers',
      'modules/admin-wallet-transfer/controllers/admin-wallet-transfer.controller.ts',
    ],
    ['/bank-changes', 'modules/seller-bank-change/controllers/admin-bank-change.controller.ts'],
    ['/leads', 'modules/invite-lead/controllers/admin-invite-lead.controller.ts'],
    ['/fx', 'modules/fx/controllers/admin-fx.controller.ts'],
    ['/pricing', 'modules/pricing/controllers/admin-pricing.controller.ts'],
    ['/roles', 'modules/staff-rbac/controllers/admin-staff-rbac.controller.ts'],
    ['/staff', 'modules/staff-invitation/admin-staff.controller.ts'],
    ['/tickets', 'modules/ticket/controllers/admin-ticket.controller.ts'],
    ['/reports', 'modules/admin-reports/admin-reports.controller.ts'],
    ['/webhooks', 'modules/admin-webhook-deliveries/admin-webhook-deliveries.controller.ts'],
    ['/delhivery', 'modules/courier-delhivery/controllers/admin-delhivery-ops.controller.ts'],
    ['/system/capacity', 'modules/system-capacity/controllers/admin-capacity.controller.ts'],
    ['/settings', 'modules/system-settings/controllers/admin-system-settings.controller.ts'],
  ];

  it.each(cases)('%s takes its controller gate', (path, controller) => {
    expect(permissionForPath(path)).toBe(classGate(controller));
  });
});

describe('longest prefix wins, so a station is not gated by its hub', () => {
  it('keeps the pickup screen on its own permission', () => {
    // '/warehouse/pick' must not swallow '/warehouse/pickups' — they
    // differ by a suffix, not a path segment.
    expect(permissionForPath('/warehouse/pickups')).toBe('courier.pickups.manage');
    expect(permissionForPath('/warehouse/pick')).toBe('warehouse.pick');
  });

  it('leaves the hub and the read surfaces alone', () => {
    expect(permissionForPath('/warehouse')).toBe('warehouse.view');
    expect(permissionForPath('/inventory')).toBe('inventory.view');
    expect(permissionForPath('/orders')).toBe('orders.view');
    expect(permissionForPath('/orders/8f3c-uuid')).toBe('orders.view');
  });

  it('opens the dashboard to every staff member', () => {
    // Where sign-in lands: a landing page that 403s is a bad first
    // impression of a system working correctly.
    expect(permissionForPath('/dashboard')).toBeNull();
    expect(canSeePath({ permissions: [] }, '/dashboard')).toBe(true);
  });
});

describe('what this actually closes, per role', () => {
  const warehouseReader = { permissions: ['warehouse.view'] };
  const inventoryReader = { permissions: ['inventory.view'] };

  it('a warehouse reader keeps the hub but not the benches', () => {
    expect(canSeePath(warehouseReader, '/warehouse')).toBe(true);
    expect(canSeePath(warehouseReader, '/warehouse/bins')).toBe(true);
    for (const p of ['/warehouse/pick', '/warehouse/pack', '/warehouse/printing']) {
      expect(canSeePath(warehouseReader, p)).toBe(false);
    }
  });

  it('an inventory reader reads stock but is turned away at the transfer form', () => {
    expect(canSeePath(inventoryReader, '/inventory')).toBe(true);
    expect(canSeePath(inventoryReader, '/inventory/movements')).toBe(true);
    expect(canSeePath(inventoryReader, '/inventory/transfers')).toBe(false);
  });
});
