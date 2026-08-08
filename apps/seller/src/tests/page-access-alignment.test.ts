import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PAGE_PERMISSIONS, canSeePath, permissionForPath } from '@/lib/page-access';

/**
 * The cosmetic route table has to agree with the server.
 *
 * Where it does not, the failure is quiet and late: somebody opens a
 * page that renders perfectly, does the work, and meets a 403 at
 * submit. Six single-purpose pages were in that state — the CSV
 * imports, the pending queue, the order edit form, API keys, webhooks
 * and notification preferences all resolved to a READ permission while
 * the server demanded a specific write one.
 *
 * Two kinds of check here. The structural one catches a permission
 * string that does not exist at all — the likeliest mistake, since
 * these are hand-typed and a typo fails CLOSED, locking out even the
 * owner. The behavioural ones pin the specific pairs that were wrong.
 */

const API_PERMISSIONS = join(__dirname, '../../../api/src/common/auth/seller-permissions.ts');

describe('every permission this table names is a real one', () => {
  it('matches the API permission catalogue exactly', () => {
    // Read the API source rather than importing it: different app,
    // different tsconfig. Same idiom as the wallet CREDIT_DIRECTIONS
    // cross-check, which reads both files for the same reason.
    const src = readFileSync(API_PERMISSIONS, 'utf8');
    const known = new Set(Array.from(src.matchAll(/key: '([^']+)'/g), (m) => m[1]));

    // Sanity: if the regex stops matching, every assertion below would
    // pass vacuously against an empty set.
    expect(known.size).toBeGreaterThan(20);

    const unknown = PAGE_PERMISSIONS.map(([, perm]) => perm).filter((p) => !known.has(p));
    expect(unknown).toEqual([]);
  });
});

describe('a single-purpose page takes the permission of its purpose', () => {
  const cases: ReadonlyArray<readonly [path: string, permission: string]> = [
    ['/orders/new', 'orders.create'],
    ['/orders/import', 'orders.import'],
    ['/orders/pending', 'orders.pending.manage'],
    ['/catalog/import', 'catalog.import'],
    ['/settings/api-keys', 'api_keys.manage'],
    ['/settings/webhooks', 'webhooks.manage'],
    ['/settings/notifications', 'notifications.manage'],
  ];

  it.each(cases)('%s needs %s', (path, permission) => {
    expect(permissionForPath(path)).toBe(permission);
  });

  it('leaves the read surfaces alone', () => {
    expect(permissionForPath('/orders')).toBe('orders.view');
    expect(permissionForPath('/orders/abc-123')).toBe('orders.view');
    expect(permissionForPath('/catalog')).toBe('catalog.view');
    expect(permissionForPath('/settings')).toBe('profile.view');
    // The seller's OWN addresses screen was removed: nothing in the
    // system read a seller address, and the page nagged for one with a
    // banner claiming consignments are booked against it. They are not.
    // Falling through to '/settings' (profile.view) is correct — there is
    // no page here to gate.
    expect(permissionForPath('/settings/addresses')).toBe('profile.view');
  });
});

describe('the * wildcard consumes exactly one segment', () => {
  it('gates the edit form under a dynamic order id', () => {
    expect(permissionForPath('/orders/8f3c-uuid/edit')).toBe('orders.create');
  });

  it('does not swallow the detail page it sits under', () => {
    // If '*' matched greedily, /orders/<id> would inherit orders.create
    // and a read-only role would lose the page they are entitled to.
    expect(permissionForPath('/orders/8f3c-uuid')).toBe('orders.view');
  });

  it('a deeper path under the wildcard still resolves', () => {
    expect(permissionForPath('/orders/8f3c-uuid/edit/anything')).toBe('orders.create');
  });
});

describe('what this actually closes, per role', () => {
  const viewer = { permissions: ['orders.view'] };
  // The real FINANCE bundle: orders.view but no order write, and
  // notifications.manage but no webhooks/api keys.
  const finance = {
    permissions: [
      'orders.view',
      'charges.view',
      'wallet.view',
      'freight.view',
      'profile.view',
      'profile.manage',
      'notifications.manage',
    ],
  };

  it('a read-only member keeps the orders they may read', () => {
    expect(canSeePath(viewer, '/orders')).toBe(true);
    expect(canSeePath(viewer, '/orders/abc-123')).toBe(true);
  });

  it('…and is turned away at the door of every order write surface', () => {
    for (const p of ['/orders/new', '/orders/abc-123/edit', '/orders/import', '/orders/pending']) {
      expect(canSeePath(viewer, p)).toBe(false);
    }
  });

  it('finance opens notification preferences but not webhooks or API keys', () => {
    expect(canSeePath(finance, '/settings/notifications')).toBe(true);
    expect(canSeePath(finance, '/settings/webhooks')).toBe(false);
    expect(canSeePath(finance, '/settings/api-keys')).toBe(false);
    // …and the hub itself still opens, so those tiles simply are not there.
    expect(canSeePath(finance, '/settings')).toBe(true);
  });
});
