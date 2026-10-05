import {
  ALL_SELLER_PERMISSION_KEYS,
  DEFAULT_SELLER_ROLES,
  SELLER_PERMISSIONS,
} from '../../src/common/auth/seller-permissions';
import { SELLER_API_KEY_SCOPES } from '../../src/common/auth/seller-api-key-scopes';
import { unionPermissions } from '../../src/common/auth/role-union';

/**
 * WHO may see what a reseller order earns the company.
 *
 * ── THE HOLE THIS CLOSES ─────────────────────────────────────────────
 * `GET /seller/orders/:id/reseller-money` declared `orders.view`, which
 * is EXACTLY what the `viewer` role holds — a role whose own description
 * is "Read-only, and only the orders. The narrowest login there is." So
 * the narrowest seller login could read the transfer price a store pays
 * and the split of every Skydrop fee: the company's margin on that sale.
 *
 * The only thing hiding it was `identity.role !== 'VIEWER'` in the
 * seller app, and that had ALREADY stopped working — the legacy enum is
 * null for anybody on a custom role, so the check passed for them. Two
 * invariants in one: FE-2 (the UI is never the boundary) and RBAC-1 (a
 * guard that reads a field which has gone null fails OPEN).
 *
 * These assert the shape of the fix rather than its wiring, because the
 * wiring is one decorator and the shape is what a later edit gets wrong.
 */
const KEY = 'stores.order_money.view';

function roleNamed(key: string) {
  const role = DEFAULT_SELLER_ROLES.find((r) => r.key === key);
  if (role === undefined) throw new Error(`No seeded seller role '${key}'`);
  return role;
}

describe('stores.order_money.view', () => {
  it('is a real key in the catalogue, and is marked sensitive', () => {
    const def = SELLER_PERMISSIONS.find((p) => p.key === KEY);
    expect(def).toBeDefined();
    expect(ALL_SELLER_PERMISSION_KEYS).toContain(KEY);
    // It exposes what the company earns. `sensitive` is what puts it
    // behind the separate confirmation on the roles screen.
    expect(def && 'sensitive' in def && def.sensitive).toBe(true);
  });

  it('is NOT in the Orders group — adjacency to orders.view is what caused this', () => {
    const def = SELLER_PERMISSIONS.find((p) => p.key === KEY);
    expect(def?.group).toBe('Reseller stores');
  });

  it.each(['admin', 'finance'])('%s holds it', (key) => {
    expect(roleNamed(key).permissions).toContain(KEY);
  });

  it.each(['viewer', 'ops', 'inventory'])('%s does NOT hold it', (key) => {
    expect(roleNamed(key).permissions).not.toContain(KEY);
  });

  /**
   * The owner's permissions list is EMPTY by construction — `is_owner`
   * grants the catalogue implicitly, which is the mechanism that means a
   * key added in a later release reaches them with no backfill anybody
   * has to remember to write. Asserted through the real resolver rather
   * than assumed, because "the owner gets everything" is the kind of
   * claim that stays written down after it stops being true.
   */
  it('an OWNER holds it implicitly, through is_owner and not a row', () => {
    const owner = roleNamed('owner');
    expect(owner.isOwner).toBe(true);
    expect(owner.permissions).toEqual([]);
    const held = unionPermissions(
      [{ superuser: true, permissions: [] }],
      ALL_SELLER_PERMISSION_KEYS,
    );
    expect(held).toContain(KEY);
  });

  /**
   * The API-key ceiling is the ABSENCE of a scope (see
   * `seller-api-key-scopes.ts`). A new key must not drift into one: a
   * credential a seller pastes into third-party software has no business
   * reading the company's margin.
   */
  it('no API-key scope grants it', () => {
    const granted = SELLER_API_KEY_SCOPES.flatMap((s) => [...s.permissions]);
    expect(granted).not.toContain(KEY);
  });

  /**
   * The seller app gates cosmetically on `/me`'s `permissions`, which is
   * the union of every role held — so a key the server enforces is
   * answerable by `can()` with no extra plumbing. If this ever stopped
   * being true the panel would render, call, and 403: correct, and
   * looking broken.
   */
  it('reaches /me for a role that holds it, so the UI can gate on it', () => {
    const held = unionPermissions(
      [{ superuser: false, permissions: [...roleNamed('finance').permissions] }],
      ALL_SELLER_PERMISSION_KEYS,
    );
    expect(held).toContain(KEY);
  });
});
