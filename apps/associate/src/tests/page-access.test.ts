import { describe, expect, it } from 'vitest';
import {
  can,
  canSeePath,
  FALLBACK_PATH,
  PAGE_PERMISSIONS,
  permissionForPath,
} from '@/lib/page-access';

/**
 * The cosmetic access table (FE-2 — the server is the boundary). What is
 * worth pinning is the LONGEST-MATCH rule: `/orders` needs `orders.view`
 * and `/orders/new` needs `orders.create`, and somebody who can read
 * orders but not place them must not be shown the "New order" link.
 */
describe('page access', () => {
  it('matches the longest pattern, not the first', () => {
    expect(permissionForPath('/orders')).toBe('orders.view');
    expect(permissionForPath('/orders/abc')).toBe('orders.view');
    expect(permissionForPath('/orders/new')).toBe('orders.create');
    expect(permissionForPath('/orders/import')).toBe('orders.create');
    expect(permissionForPath('/tickets')).toBe('tickets.view');
    expect(permissionForPath('/tickets/new')).toBe('tickets.manage');
  });

  it('leaves the self-service pages ungated (NOTIF-11)', () => {
    // A person's own account and their own inbox. Both are addressed by
    // the id on the TOKEN, so a permission would be asking a question
    // the token has already answered — and a permission has to be
    // GRANTED, so a key added today reaches no role that already exists
    // and the bell would render then 403 for most of the estate.
    for (const path of ['/account', '/notifications']) {
      expect(permissionForPath(path), path).toBeNull();
      expect(canSeePath({ permissions: [] }, path), path).toBe(true);
    }
  });

  it('gates “what I sell” on catalogue.sell and NEVER on catalogue.view', () => {
    // The privacy boundary, as a route: `catalogue.view` carries
    // `transferPriceInr` — what the STORE pays its seller, and so the
    // spread the store makes on this person. An associate does not hold
    // it, and a page here gated on it would be a page that 403s; worse,
    // one gated on it that somehow rendered would be reading the wrong
    // endpoint.
    expect(permissionForPath('/catalogue')).toBe('catalogue.sell');
    expect(PAGE_PERMISSIONS.map((e) => e[1])).not.toContain('catalogue.view');
    expect(canSeePath({ permissions: ['catalogue.sell'] }, '/catalogue')).toBe(true);
    expect(canSeePath({ permissions: ['catalogue.view'] }, '/catalogue')).toBe(false);
  });

  it('refuses a page whose permission is not held', () => {
    const readOnly = { permissions: ['orders.view'] };
    expect(canSeePath(readOnly, '/orders')).toBe(true);
    expect(canSeePath(readOnly, '/orders/new')).toBe(false);
    expect(canSeePath(null, '/orders')).toBe(false);
  });

  it('`can` is ANY-of, and null holds nothing', () => {
    expect(can({ permissions: ['orders.cancel'] }, 'orders.cancel', 'orders.actions')).toBe(true);
    expect(can({ permissions: ['orders.view'] }, 'orders.cancel')).toBe(false);
    expect(can(null, 'orders.view')).toBe(false);
  });

  it('every entry opens a page an associate’s role can reach', () => {
    // The `associate` role (common/auth/store-permissions.ts) holds these.
    const associate = [
      'store.profile.view',
      'catalogue.sell',
      'orders.view',
      'orders.create',
      'orders.cancel',
      'orders.actions',
      'customers.view',
      'tickets.view',
      'tickets.manage',
    ];
    for (const [pattern, permission] of PAGE_PERMISSIONS) {
      expect(associate, `${pattern} is gated on a permission an associate does not hold`).toContain(
        permission,
      );
    }
  });

  it('falls back somewhere an associate can actually go', () => {
    expect(FALLBACK_PATH).toBe('/orders');
    expect(permissionForPath(FALLBACK_PATH)).toBe('orders.view');
  });
});
