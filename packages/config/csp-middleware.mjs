/**
 * Per-request CSP nonce, shared by the Next.js apps.
 *
 * ── WHY THIS EXISTS ──────────────────────────────────────────────────
 * The static CSP in `security-headers.mjs` had to allow
 * `script-src 'unsafe-inline'`, because Next's App Router injects inline
 * bootstrap and hydration scripts and a static header cannot know what
 * they will contain. `'unsafe-inline'` means the directive does not stop
 * script injection at all — it only ever contained the damage via
 * connect-src and friends.
 *
 * A nonce fixes that properly. Middleware mints one random value per
 * request, puts it in the CSP, and forwards it on a request header;
 * Next reads the nonce out of the CSP header and stamps it onto the
 * scripts it generates. An injected `<script>` has no nonce, so the
 * browser refuses to execute it.
 *
 * ── 'strict-dynamic' ─────────────────────────────────────────────────
 * Included deliberately. Next's bootstrap script loads further chunks by
 * inserting script tags, and those inserted tags carry no nonce of their
 * own. Without 'strict-dynamic' the page half-loads. With it, trust
 * propagates from the nonce'd bootstrap to what it loads — which is the
 * intended model, and still gives an injected tag nothing.
 *
 * Note that 'strict-dynamic' makes host-based script sources ('self',
 * https:) IGNORED by supporting browsers. They stay in the list only as
 * a fallback for older engines that do not understand 'strict-dynamic'.
 *
 * ── THE COST, STATED ─────────────────────────────────────────────────
 * A nonce is by definition per-request, so any route this runs on cannot
 * be served from the full-page static cache. The matcher below therefore
 * skips static assets and images. For admin and seller that costs
 * nothing real — every page behind the auth gate is dynamic already.
 */

/** Base64url of 16 random bytes, via Web Crypto (Edge runtime safe). */
function makeNonce() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * Build the CSP for one request.
 *
 * @param {string} nonce the per-request nonce
 * @param {{ isDev: boolean, connectExtra?: string[], imgExtra?: string[] }} opts
 *   `isDev` adds 'unsafe-eval' for React Refresh — production must not
 *   have it. The two extras are per-app origins (Spaces, for seller).
 * @returns {string}
 */
function cspFor(nonce, { isDev, connectExtra = [], imgExtra = [] }) {
  const scriptSrc = [
    `'nonce-${nonce}'`,
    "'strict-dynamic'",
    // Ignored by browsers that honour 'strict-dynamic'; kept as the
    // fallback for those that do not.
    "'self'",
    'https:',
    // React Refresh evaluates code in development only.
    ...(isDev ? ["'unsafe-eval'"] : []),
  ].join(' ');

  return [
    "default-src 'self'",
    `script-src ${scriptSrc}`,
    // Styles keep 'unsafe-inline': Tailwind and styled-jsx emit inline
    // style attributes, nonce-ing them is not practical, and an injected
    // <style> is a defacement risk rather than a code-execution one.
    "style-src 'self' 'unsafe-inline'",
    `img-src 'self' data: blob:${imgExtra.length ? ` ${imgExtra.join(' ')}` : ''}`,
    "font-src 'self' data:",
    // The directive that limits what an injected script could do if one
    // ever did run: it cannot talk to an origin that is not listed.
    `connect-src 'self'${connectExtra.length ? ` ${connectExtra.join(' ')}` : ''}${
      isDev ? ' ws: http://localhost:*' : ''
    }`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    'upgrade-insecure-requests',
  ].join('; ');
}

/**
 * Factory for an app's middleware.
 *
 * The JSDoc types are load-bearing: without them TypeScript infers
 * `never[]` from the empty-array defaults and rejects every caller that
 * passes an origin.
 *
 * @param {{ connectExtra?: string[], imgExtra?: string[] }} [opts]
 * @returns {(request: { headers: Headers }) => { requestHeaders: Headers, csp: string }}
 */
export function createCspMiddleware({ connectExtra = [], imgExtra = [] } = {}) {
  return function middleware(request) {
    const nonce = makeNonce();
    const isDev = process.env.NODE_ENV !== 'production';
    const csp = cspFor(nonce, { isDev, connectExtra, imgExtra });

    // Forward the nonce to the render. Next looks for the nonce inside
    // the CSP request header specifically — passing only `x-nonce` is not
    // enough for it to stamp its own scripts.
    const requestHeaders = new Headers(request.headers);
    requestHeaders.set('x-nonce', nonce);
    requestHeaders.set('content-security-policy', csp);

    return { requestHeaders, csp };
  };
}

/**
 * NOTE: the route matcher canNOT live here. Next statically analyses the
 * `config` export of a middleware file at build time and rejects an
 * imported value, so each app inlines its own literal. The comment at
 * that inline explains what is excluded and why.
 */
