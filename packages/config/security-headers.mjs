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
 * ── THE KNOWN WEAKNESS, STATED PLAINLY ───────────────────────────────
 * `script-src` includes 'unsafe-inline'. Next.js App Router injects
 * inline bootstrap and hydration scripts, and removing that needs
 * per-request nonces threaded through middleware, which interacts badly
 * with static optimisation. So this CSP does NOT block script injection
 * itself. What it still buys, and the reason it is worth having anyway:
 *
 *   connect-src   an injected script cannot exfiltrate to another origin
 *   form-action   it cannot post credentials to another origin
 *   base-uri      it cannot rewrite relative URLs via an injected <base>
 *   object-src    no plugin-based escape hatch
 *   frame-ancestors  the panel cannot be framed for clickjacking
 *
 * Adding nonces is the follow-up that makes script-src meaningful.
 */

/** Directives every app shares. Per-app extras are merged in below. */
function baseCsp({ connectExtra = [], imgExtra = [] } = {}) {
  return [
    "default-src 'self'",
    // See the note above: inline is required by Next's hydration.
    "script-src 'self' 'unsafe-inline'",
    // Tailwind + styled-jsx emit inline styles.
    "style-src 'self' 'unsafe-inline'",
    // data: for inlined icons, blob: for client-side previews.
    `img-src 'self' data: blob:${imgExtra.length ? ` ${imgExtra.join(' ')}` : ''}`,
    "font-src 'self' data:",
    // The load-bearing one. FE-3 says the browser talks only to its own
    // origin; this is that rule enforced rather than merely intended.
    `connect-src 'self'${connectExtra.length ? ` ${connectExtra.join(' ')}` : ''}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    // Modern equivalent of X-Frame-Options: DENY. Both are sent; the
    // header is the fallback for anything that predates CSP level 2.
    "frame-ancestors 'none'",
    'upgrade-insecure-requests',
  ].join('; ');
}

function commonHeaders(csp) {
  return [
    { key: 'Content-Security-Policy', value: csp },
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
}

/**
 * Admin console. Strictest: same-origin everything, because FE-3 means
 * the browser has no legitimate reason to reach anywhere else.
 */
export const adminSecurityHeaders = commonHeaders(baseCsp());

/**
 * Seller portal. Same as admin, plus DigitalOcean Spaces — the catalog
 * image upload PUTs directly to a presigned URL (deliberately not through
 * our origin, since the presign is to Spaces), and the uploaded images are
 * then displayed from there.
 */
export const sellerSecurityHeaders = commonHeaders(
  baseCsp({
    connectExtra: ['https://*.digitaloceanspaces.com'],
    imgExtra: ['https://*.digitaloceanspaces.com'],
  }),
);

/**
 * Public tracking. No authenticated session and no uploads, so it gets
 * the tightest policy of the three.
 */
export const trackSecurityHeaders = commonHeaders(baseCsp());

/** Applies a header set to every route. */
export function allRoutes(headers) {
  return [{ source: '/:path*', headers }];
}
