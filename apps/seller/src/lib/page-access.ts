import type { SellerMe } from '@skydrop/api-client';

/**
 * Which pages each permission opens.
 *
 * Replaces the role table this file used to be. That table had six
 * entries, five of which said `'*'` — every role except VIEWER saw the
 * whole app. It could not express "handles inbound stock, must not see
 * the wallet", so a company either gave somebody everything or gave them
 * read-only orders.
 *
 * ── COSMETIC ONLY (FE-2) ─────────────────────────────────────────────
 * This hides links and blocks routes. It is NOT the boundary — the API's
 * permission guard is, and it refuses whatever this renders. Keeping the
 * two in step is a courtesy: without it somebody sees fifteen menu items,
 * clicks one, and learns from a 403 that it was never theirs.
 *
 * ── ONE TABLE, TWO CONSUMERS ─────────────────────────────────────────
 * The nav filter and the route boundary both read from HERE. Two lists
 * drift, and both failure modes are ugly: a link to a page that refuses
 * to render, or a reachable page with no way to navigate to it.
 *
 * Longest prefix wins, so `/settings/addresses` can differ from
 * `/settings`. A path matching nothing is allowed through — the
 * boundary enforces this table, it is not a second router. `/dashboard`
 * is deliberately open: it is where sign-in lands, and a landing page
 * that refuses is a bad first impression of a system working correctly.
 */
export const PAGE_PERMISSIONS: ReadonlyArray<readonly [prefix: string, permission: string]> = [
  // Longest prefix wins, so this beats '/orders' below. It has to be
  // listed: the create FORM is a write surface, and the server guards
  // POST /seller/orders with `orders.create`. Resolving it to
  // `orders.view` let a read-only role open the form, fill it in and
  // meet the 403 only at submit.
  ['/orders/new', 'orders.create'],
  ['/orders', 'orders.view'],
  ['/tracking', 'orders.view'],
  ['/customers', 'customers.view'],
  ['/tickets', 'tickets.view'],
  ['/catalog', 'catalog.view'],
  ['/inventory', 'inventory.view'],
  ['/inbound', 'inbound.view'],
  ['/holds', 'holds.manage'],
  ['/wallet', 'wallet.view'],
  ['/freight', 'freight.view'],
  ['/team/roles', 'roles.manage'],
  ['/team', 'team.view'],
  ['/profile', 'profile.view'],
  ['/settings/addresses', 'addresses.manage'],
  ['/settings', 'profile.view'],
];

export function permissionForPath(pathname: string | null): string | null {
  if (pathname === null) return null;
  let best: readonly [string, string] | null = null;
  for (const entry of PAGE_PERMISSIONS) {
    if (pathname === entry[0] || pathname.startsWith(`${entry[0]}/`)) {
      if (best === null || entry[0].length > best[0].length) best = entry;
    }
  }
  return best?.[1] ?? null;
}

export function canSeePath(
  identity: Pick<SellerMe, 'permissions'> | null,
  pathname: string | null,
): boolean {
  const needed = permissionForPath(pathname);
  if (needed === null) return true;
  return identity !== null && identity.permissions.includes(needed);
}

/** Whether this person holds ANY of these permissions. Used for sections
 *  and buttons inside a page they are allowed to open. */
export function can(
  identity: Pick<SellerMe, 'permissions'> | null,
  ...anyOf: readonly string[]
): boolean {
  if (identity === null) return false;
  return anyOf.some((p) => identity.permissions.includes(p));
}

/**
 * Where somebody lands when the page they asked for is not theirs.
 *
 * The dashboard, because everyone may see it. Sending them to the first
 * page they CAN see would be cleverer and worse: it varies per person,
 * so two people describing "the page it sent me to" would not be
 * describing the same page.
 */
export const FALLBACK_PATH = '/dashboard';
