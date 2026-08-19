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
/**
 * ── A SINGLE-PURPOSE PAGE TAKES THE PERMISSION OF ITS PURPOSE ────────
 * A page that exists only to perform one restricted action must ask for
 * THAT permission, not the looser one its URL prefix implies. Where the
 * two differ the person opens a working-looking screen and learns at
 * submit that it was never theirs — worse than being told at the door,
 * because they have typed an order in by then.
 *
 * Each entry below that is narrower than its prefix names the server
 * guard it mirrors. When those move, this moves.
 *
 * A `*` matches exactly ONE path segment, for routes whose write
 * surface sits under a dynamic id.
 */
export const PAGE_PERMISSIONS: ReadonlyArray<readonly [pattern: string, permission: string]> = [
  ['/orders/new', 'orders.create'], // POST   /seller/orders
  ['/orders/*/edit', 'orders.create'], // PATCH  /seller/orders/:id
  ['/orders/import', 'orders.import'], // @Controller seller/order-imports
  ['/orders/pending', 'orders.pending.manage'], // @Controller seller/orders-pending
  ['/orders', 'orders.view'],
  ['/tracking', 'orders.view'],
  ['/customers', 'customers.view'],
  ['/tickets', 'tickets.view'],
  ['/products/new', 'catalog.manage'], // POST /seller/products (+ /variants)
  ['/products/import', 'catalog.import'], // @Controller seller/csv-imports
  ['/products', 'catalog.view'],
  ['/inventory', 'inventory.view'],
  ['/inbound', 'inbound.view'],
  ['/holds', 'holds.manage'],
  ['/wallet', 'wallet.view'],
  ['/freight', 'freight.view'],
  ['/team/roles', 'roles.manage'],
  ['/team', 'team.view'],
  ['/profile', 'profile.view'],
  ['/settings/stock', 'inventory.view'], // @Controller seller/stock (alert-config)
  ['/settings/orders', 'orders.view'], // @Controller seller/order-defaults
  ['/settings/api-keys', 'api_keys.manage'], // @Controller seller/api-keys
  ['/settings/webhooks', 'webhooks.manage'], // @Controller seller/webhook-endpoints
  ['/settings/notifications', 'notifications.manage'], // @Controller seller/notification-preferences
  ['/settings', 'profile.view'],
];

/**
 * Does `pathname` sit at or under `pattern`? `*` consumes exactly one
 * segment, so `/orders/*` does NOT swallow `/orders/abc/edit` — that
 * would make a wildcard entry quietly outrank the specific rules below
 * it.
 */
function matches(pattern: string, pathname: string): boolean {
  if (!pattern.includes('*')) {
    return pathname === pattern || pathname.startsWith(`${pattern}/`);
  }
  const pat = pattern.split('/');
  const got = pathname.split('/');
  if (got.length < pat.length) return false;
  return pat.every((seg, i) => seg === '*' || seg === got[i]);
}

export function permissionForPath(pathname: string | null): string | null {
  if (pathname === null) return null;
  let best: readonly [string, string] | null = null;
  for (const entry of PAGE_PERMISSIONS) {
    if (!matches(entry[0], pathname)) continue;
    // Specificity is segment count first — '/orders/*/edit' must beat
    // '/orders' on a path both match — then literal length as the
    // tie-break between two rules of the same depth.
    const depth = entry[0].split('/').length;
    const bestDepth = best === null ? -1 : best[0].split('/').length;
    if (depth > bestDepth || (depth === bestDepth && entry[0].length > (best?.[0].length ?? 0))) {
      best = entry;
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
