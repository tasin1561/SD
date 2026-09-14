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
