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
 * The Permissions-Policy value, with the camera as the ONE knob.
 *
 * `camera=()` denies it to every origin INCLUDING our own, and the
 * failure is silent in the way that costs the most time: `getUserMedia`
 * rejects immediately with a `NotAllowedError` and the browser never
 * shows a prompt, so it presents exactly as a user having refused
 * permission they were never asked for. That is what the pack bench and
 * the handover bench hit — a camera button that could not, structurally,
 * ever work, on a page whose whole job is scanning.
 *
 * `(self)` is still narrow: the feature is allowed for this origin only
 * and for no embedded frame, and it does NOT grant anything — Chrome
 * asks the operator exactly as it would on any other site. Everything
 * else stays denied outright, and the three apps that never scan keep
 * denying the camera too, because a capability nothing uses should not
 * be reachable from an injected script.
 */
export function permissionsPolicy({ camera = false } = {}) {
  return [
    `camera=(${camera ? 'self' : ''})`,
    'microphone=()',
    'geolocation=()',
    'payment=()',
    'usb=()',
    'interest-cohort=()',
  ].join(', ');
}

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
  // Nothing here needs any of these. apps/admin overrides the camera
  // half — see `permissionsPolicy` below.
  {
    key: 'Permissions-Policy',
    value: permissionsPolicy(),
  },
  // Isolates the browsing context from cross-origin popups it opens.
  { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
  { key: 'X-DNS-Prefetch-Control', value: 'off' },
];

/**
 * The same set with one header replaced. Used by apps/admin for the
 * camera; a `map` at the call site would put the policy string in two
 * places, and the second copy is the one that goes stale.
 */
export function withHeader(headers, key, value) {
  return headers.map((h) => (h.key === key ? { key, value } : h));
}

/** Applies a header set to every route. */
export function allRoutes(headers) {
  return [{ source: '/:path*', headers }];
}
