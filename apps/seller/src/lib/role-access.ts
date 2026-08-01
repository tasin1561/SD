import type { SellerMe } from '@skydrop/api-client';

export type SellerRole = SellerMe['role'];

/**
 * Which parts of the seller app each role is shown.
 *
 * ── COSMETIC ONLY (FE-2) ─────────────────────────────────────────────
 * This hides controls a role cannot use. It is NOT the security
 * boundary — `SellerJwtGuard` is, and it rejects the request whatever
 * this table says. Keeping them in step is a courtesy to the user, not
 * a control: before this existed, a VIEWER could open the new-order
 * form, fill it in, and only learn on submit that they were not allowed
 * to save it.
 *
 * ── ONE TABLE, TWO CONSUMERS ─────────────────────────────────────────
 * The nav filter and the route guard both read from here. Two lists
 * would drift, and the failure mode is ugly in both directions: a nav
 * link to a page that refuses to render, or a reachable page with no
 * way back to it.
 *
 * `'*'` means "everything" — the four roles that see the whole company
 * view and differ only in what they may CHANGE. VIEWER is the one role
 * whose READ surface is narrowed, and the server agrees: only
 * controllers marked `@SellerViewerReadable()` answer a VIEWER, which
 * today is the orders surface (list, detail, and the event timeline the
 * tracking view is built from).
 */
const ALLOWED_PREFIXES: Record<SellerRole, readonly string[] | '*'> = {
  OWNER: '*',
  ADMIN: '*',
  OPS: '*',
  INVENTORY: '*',
  FINANCE: '*',
  VIEWER: ['/orders', '/tracking'],
};

/** Where a role lands when it has no business on the page it asked for. */
export function homeFor(role: SellerRole): string {
  const allowed = ALLOWED_PREFIXES[role];
  return allowed === '*' ? '/dashboard' : (allowed[0] ?? '/orders');
}

/**
 * Whether `role` may see `pathname`.
 *
 * Matches on a path SEGMENT — `/orders` covers `/orders/abc` and
 * `/orders/abc/edit`, and deliberately does not match a sibling route
 * that merely starts with the same letters.
 */
export function canAccess(role: SellerRole, pathname: string | null): boolean {
  const allowed = ALLOWED_PREFIXES[role];
  if (allowed === '*') return true;
  if (pathname === null) return true;
  return allowed.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

/** True when the role sees the whole app — used to skip nav filtering. */
export function seesEverything(role: SellerRole): boolean {
  return ALLOWED_PREFIXES[role] === '*';
}
