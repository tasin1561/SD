import type { StoreMe } from '@skydrop/api-client';

/**
 * Which pages each store permission opens (ASSOC-1).
 *
 * COSMETIC ONLY (FE-2). This hides links and blocks routes; the API's
 * store guard refuses whatever this renders. ONE table, read by both the
 * nav filter and the route boundary, so a link can never point at a page
 * that refuses to render.
 *
 * `/account` and `/notifications` are deliberately absent — open to
 * every store user, because both are about the caller themselves (their
 * own email and sessions; their own inbox). That is NOTIF-11's rule and
 * it is load-bearing twice over: every inbox row is addressed by the id
 * on the TOKEN, so a permission would be asking a question the token has
 * already answered; and a permission has to be GRANTED, so a key added
 * today reaches no role that already exists and the bell would render
 * then 403 for most of the estate on the day it shipped. The API's
 * `StoreNotificationController` is `@StoreSelfService()` to match.
 *
 * The table is SHORT on purpose. An associate does five things, and a
 * nav item that would 403 does not exist here at all — a link to a page
 * somebody cannot open teaches them to stop reading the nav.
 */
export const PAGE_PERMISSIONS: ReadonlyArray<readonly [pattern: string, permission: string]> = [
  // GET /store/orders · GET /store/orders/:id, narrowed to the orders
  // this person placed by `store_roles.order_scope` server-side.
  ['/orders', 'orders.view'],
  // POST /store/orders. The longer entries win over '/orders' above.
  ['/orders/new', 'orders.create'],
  // /store/order-imports/*
  ['/orders/import', 'orders.create'],
  // GET /store/catalogue/sell — what THIS person may sell, at their own
  // price. `catalogue.sell`, never `catalogue.view`: the second carries
  // what the store pays its seller.
  ['/catalogue', 'catalogue.sell'],
  // GET /store/customers — the same scope narrowing as the orders.
  ['/customers', 'customers.view'],
  // GET /store/tickets
  ['/tickets', 'tickets.view'],
  // POST /store/tickets
  ['/tickets/new', 'tickets.manage'],
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
  identity: Pick<StoreMe, 'permissions'> | null,
  pathname: string | null,
): boolean {
  const needed = permissionForPath(pathname);
  if (needed === null) return true;
  return identity !== null && identity.permissions.includes(needed);
}

/** Whether this person holds ANY of these permissions (for buttons inside a page). */
export function can(
  identity: Pick<StoreMe, 'permissions'> | null,
  ...anyOf: readonly string[]
): boolean {
  if (identity === null) return false;
  return anyOf.some((p) => identity.permissions.includes(p));
}

export const FALLBACK_PATH = '/orders';
