/**
 * Security response headers, shared by the Next.js apps.
 *
 * Plain ESM with no build step: each app's `next.config.mjs` imports it
 * by relative path, so there is ONE source of truth and no chance of the
 * four apps drifting into four different postures.
 *
 * ── WHY THIS MATTERS MORE HERE THAN IN A TYPICAL APP ─────────────────
 * FE-1 keeps the access token in JavaScript memory on purpose — that is
 * the right call versus localStorage, but it means the token is reachable
 * by any script that executes on the page. There is no HttpOnly wall
 * around it. So the value of a CSP here is less "stop the injection" and
 * more "make an injection unable to phone home": `connect-src 'self'`
 * means a script that does run cannot POST the token to an attacker's
 * origin. That is also exactly what FE-3 already asserts at the
 * architecture level — this enforces it in the browser.
 *
 * ── WHERE THE CSP ITSELF LIVES ───────────────────────────────────────
 * NOT here. A Content-Security-Policy carrying a per-request nonce
 * cannot be a static header, so it is emitted by middleware
 * (`csp-middleware.mjs`). This module owns only the headers that are the
 * same on every response.
 *
 * That split matters: if both emitted a CSP the browser would enforce
 * BOTH, and the intersection of a nonce policy and an 'unsafe-inline'
 * one blocks Next's own scripts. One owner, no ambiguity.
 */

/**
 * The headers that are identical on every response of every app. The
 * per-request CSP is emitted by middleware; see the note above.
 */
export const staticSecurityHeaders = [
  // Two years, subdomains included. Cloudflare may also set this;
  // duplicating it costs nothing and means the origin is still correct
  // if traffic ever bypasses the edge.
  {
    key: 'Strict-Transport-Security',
    value: 'max-age=63072000; includeSubDomains; preload',
  },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  // Send the origin cross-site, the full path same-site. Order URLs
  // carry ids; those should not leak to third parties in a Referer.
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  // Nothing here needs any of these.
  {
    key: 'Permissions-Policy',
    value: 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()',
  },
  // Isolates the browsing context from cross-origin popups it opens.
  { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
  { key: 'X-DNS-Prefetch-Control', value: 'off' },
];

/** Applies a header set to every route. */
export function allRoutes(headers) {
  return [{ source: '/:path*', headers }];
}
