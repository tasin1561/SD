import type { StoreMe } from '@skydrop/api-client';

/**
 * Which pages each store permission opens (RS-2).
 *
 * COSMETIC ONLY (FE-2). This hides links and blocks routes; the API's
 * store guard refuses whatever this renders. ONE table, read by both the
 * nav filter and the route boundary, so a link can never point at a page
 * that refuses to render.
 *
 * `/dashboard` and `/account` are deliberately absent — open to every
 * store user: the dashboard is where sign-in lands, and the account page
 * is about the caller themselves (their own email and sessions).
 *
 * Each entry names the permission of the endpoint its page calls; the
 * page-permission check (scripts/check-page-permissions.py) reads this
 * table against the store controllers.
 */
export const PAGE_PERMISSIONS: ReadonlyArray<readonly [pattern: string, permission: string]> = [
  ['/team', 'team.view'], // GET /store/team
  ['/settings', 'store.profile.view'], // GET /store/profile
  ['/catalogue', 'catalogue.view'], // GET /store/catalogue (RS-3)
  ['/terms', 'terms.view'], // GET /store/terms (RS-4); accepting needs terms.accept
  ['/wallet', 'wallet.view'], // GET /store/wallet (RS-6)
  // RS-5 — the store's orders, customers and integrations.
  // GET /store/orders; cancelling needs orders.cancel, and asking for a
  // call, a re-attempt or a return needs orders.actions (2026-09-16) —
  // both gated in the page's own code, not by this entry.
  ['/orders', 'orders.view'],
  // 2026-09-16 — "we could not reach your customer; keep trying or give
  // the stock back". Gated on the permission that ANSWERS it rather than
  // the one that reads orders: the page exists to be acted on, and its
  // own endpoints (GET/PATCH /store/call-reviews) need orders.actions.
  // The longer entry wins over '/orders' above.
  ['/orders/call-reviews', 'orders.actions'],
  ['/orders/new', 'orders.create'], // POST /store/orders (the picker reads the catalogue)
  ['/orders/import', 'orders.create'], // /store/order-imports/*
  ['/customers', 'customers.view'], // GET /store/customers
  ['/integrations', 'integrations.manage'], // /store/api-keys, /store/webhook-endpoints
  // RS-8 / RS-9 — the store's reports and its own expense book.
  ['/reports', 'reports.view'], // GET /store/reports/*
  ['/expenses', 'expenses.view'], // GET /store/expenses; recording needs expenses.manage
  // RS-7 — the store's disputes with its seller.
  ['/tickets', 'tickets.view'], // GET /store/tickets
  ['/tickets/new', 'tickets.manage'], // POST /store/tickets
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

export const FALLBACK_PATH = '/dashboard';
