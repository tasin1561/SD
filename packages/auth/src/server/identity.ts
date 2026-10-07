/**
 * Server-side identity resolution for Next.js App Router server
 * components / route handlers.
 *
 * The SSR boot flow (FE-4):
 *   - The browser sends the __Host-{staff,seller}Refresh cookie to
 *     admin.skydrop.global (same-origin to the Next.js app).
 *   - The Server Component reads the cookie from the incoming
 *     request (via Next's cookies() helper — passed in by the
 *     caller; we don't import 'next/headers' here to keep this
 *     package framework-neutral).
 *   - We call /api/auth/{kind}/me on a server-side fetch with the
 *     cookie forwarded. The hybrid /me (M12 commit 1) accepts the
 *     cookie path; it is READ-ONLY (no rotation), so this never
 *     races the client's own silent-refresh.
 *   - If /me returns 200, identity is hydrated for the page.
 *   - If /me returns 401, the page redirects to /login (caller's
 *     responsibility).
 *
 * Identity-parameterized — apps/admin passes 'staff'; apps/seller
 * (later) passes 'seller'. The cookie name and /me path are derived
 * from `identityKind`.
 *
 * Crucially: this function does NOT rotate. It does not touch /refresh.
 * Server-side rotation would race the client's own refresh and the
 * API's reuse-detection family-burn would fire on the LEGITIMATE
 * session — see CLAUDE.md / M12 commit 1 / Decision #1.
 */

import type { IdentityKind, SellerMe, StaffMe, StoreMe } from '@skydrop/api-client';

/**
 * The refresh cookie each identity's app is anchored on. A `Record` over
 * `IdentityKind`, so a fourth identity fails to compile until somebody
 * names its cookie. RS-2 added `store` (apps/reseller).
 */
/**
 * The support-session cookie, named here as well as in the API because
 * this package cannot import from it. `impersonation-cookie.ts` in the
 * API is the authority; `ssr-impersonation-cookie.test.ts` holds the two
 * together.
 */
const IMPERSONATION_COOKIE = '__Host-impersonation';

const COOKIE_BY_KIND: Record<IdentityKind, string> = {
  staff: '__Host-staffRefresh',
  seller: '__Host-sellerRefresh',
  store: '__Host-storeRefresh',
};

export interface SsrIdentityRequest {
  /** The full API origin (`http://localhost:3000` in dev,
   *  `https://api.skydrop.global` in prod). The SSR path goes
   *  DIRECT to the API server-to-server, not through the Next.js
   *  proxy — the proxy only matters for the browser. */
  readonly apiOrigin: string;
  readonly identityKind: IdentityKind;
  /** The raw cookie value the browser sent (caller pulls from
   *  next/headers cookies()). Pass empty string if the cookie
   *  is absent (we'll surface as `notAuthenticated`). */
  readonly cookieValue: string;
  /**
   * A SUPPORT SESSION's cookie, when the browser is carrying one.
   *
   * ── WHY THIS IS A SECOND COOKIE AND NOT THE FIRST ───────────────────
   * A staff member inside somebody's account on a support session holds
   * `__Host-impersonation` and NO refresh cookie — they never signed in
   * as the seller, because there is no password they could have used.
   * Without this, `cookieValue` is empty, this resolver answers
   * `not-authenticated` before it asks the API anything, and the layout
   * redirects to /login: the session is unreachable from the first
   * navigation, and the API's guard — which handles the cookie
   * perfectly — never gets a say.
   *
   * Forwarded ALONGSIDE the refresh cookie rather than instead of it.
   * The API decides which one it honours; this only stops the browser's
   * credentials being dropped on the floor before they arrive.
   */
  readonly impersonationCookieValue?: string;
  /** Override fetch for tests. */
  readonly fetchImpl?: typeof fetch;
}

export type SsrIdentityResult<T> =
  | { readonly state: 'authenticated'; readonly identity: T }
  | { readonly state: 'not-authenticated' }
  | { readonly state: 'forbidden'; readonly code: string };

/**
 * Resolve the staff identity from the SSR request cookie. Returns:
 *   - 'authenticated' with the StaffMe identity on success
 *   - 'not-authenticated' on 401 (no cookie / invalid / expired —
 *     caller redirects to /login)
 *   - 'forbidden' on any other client-error code (e.g., a future
 *     status-recheck gate; staff doesn't have one today but the
 *     shape allows it)
 *
 * Network / 5xx errors bubble up so the caller can show a generic
 * "service unavailable" rather than masking outage as "logged out".
 */
export async function resolveStaffSsrIdentity(
  req: SsrIdentityRequest,
): Promise<SsrIdentityResult<StaffMe>> {
  return resolveSsrIdentity<StaffMe>(req);
}

export async function resolveSellerSsrIdentity(
  req: SsrIdentityRequest,
): Promise<SsrIdentityResult<SellerMe>> {
  return resolveSsrIdentity<SellerMe>(req);
}

/** RS-2 — a reseller store user (apps/reseller). Read-only, like the others (FE-4). */
export async function resolveStoreSsrIdentity(
  req: SsrIdentityRequest,
): Promise<SsrIdentityResult<StoreMe>> {
  return resolveSsrIdentity<StoreMe>(req);
}

async function resolveSsrIdentity<T>(req: SsrIdentityRequest): Promise<SsrIdentityResult<T>> {
  // EITHER credential is enough to be worth asking. A support session
  // carries only the impersonation cookie; refusing on the absence of a
  // refresh cookie would log the staff member out of an account they
  // are legitimately inside, on the first page they open.
  if (!req.cookieValue && !req.impersonationCookieValue) {
    return { state: 'not-authenticated' };
  }
  const cookieName = COOKIE_BY_KIND[req.identityKind];
  const fetchImpl = req.fetchImpl ?? globalThis.fetch.bind(globalThis);

  const res = await fetchImpl(`${req.apiOrigin}/auth/${req.identityKind}/me`, {
    method: 'GET',
    headers: {
      Accept: 'application/json',
      // Forward the EXACT cookie the browser sent. We pass the
      // raw cookie value (e.g. "abc123") under the right name —
      // the API's cookie-parser middleware picks it up.
      //
      // Both, when both are present: the API's guard prefers the
      // support session, and sending only one of them would make the
      // answer depend on which this file happened to pick.
      Cookie: [
        req.cookieValue ? `${cookieName}=${req.cookieValue}` : null,
        req.impersonationCookieValue
          ? `${IMPERSONATION_COOKIE}=${req.impersonationCookieValue}`
          : null,
      ]
        .filter((c): c is string => c !== null)
        .join('; '),
    },
    cache: 'no-store',
  });

  if (res.status === 401) return { state: 'not-authenticated' };
  if (res.status === 403) {
    const body = await safeJson(res);
    const code =
      typeof body === 'object' && body !== null && 'code' in body
        ? String((body as { code: unknown }).code)
        : 'FORBIDDEN';
    return { state: 'forbidden', code };
  }
  if (!res.ok) {
    throw new Error(`SSR /me failed: status ${res.status}`);
  }
  const identity = (await res.json()) as T;
  return { state: 'authenticated', identity };
}

async function safeJson(res: Response): Promise<unknown> {
  try {
    return await res.json();
  } catch {
    return null;
  }
}
