import { NextResponse, type NextRequest } from 'next/server';
import { createCspMiddleware } from '../../../packages/config/csp-middleware.mjs';

/**
 * Per-request CSP nonce (ASSOC-1).
 *
 * The policy itself lives in packages/config/csp-middleware.mjs so the
 * apps cannot drift. See that file for why 'strict-dynamic' is required
 * and what the nonce actually buys over the previous 'unsafe-inline'.
 *
 * No `connectExtra` / `imgExtra` here, and that is deliberate: an
 * associate uploads nothing to Spaces except a CSV, which goes through a
 * presigned PUT — so the connect allowance IS needed, but no image is
 * ever loaded from Spaces by this app except a product thumbnail the
 * catalogue hands over presigned. Both are listed below rather than
 * inherited, because a policy that is wider than the app needs is a
 * policy nobody can reason about later.
 */
const build = createCspMiddleware({
  // The CSV import PUTs straight to a presigned Spaces URL.
  connectExtra: ['https://*.digitaloceanspaces.com'],
  // Product thumbnails on the order form arrive as presigned Spaces URLs.
  imgExtra: ['https://*.digitaloceanspaces.com'],
});

export function middleware(request: NextRequest): NextResponse {
  const { requestHeaders, csp } = build(request) as {
    requestHeaders: Headers;
    csp: string;
  };

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  // Also on the RESPONSE — the request header is how Next learns the
  // nonce; this header is what the browser actually enforces.
  response.headers.set('Content-Security-Policy', csp);
  return response;
}

export const config = {
  // MUST be an inline literal: Next statically analyses this field at
  // build time and rejects an imported value ("can't recognize the
  // exported `config` field"). So this one block is duplicated across
  // the consoles by necessity, not by choice — the POLICY it guards
  // still lives in one place.
  matcher: [
    {
      source:
        '/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|css|js|woff2?)$).*)',
      missing: [
        { type: 'header', key: 'next-router-prefetch' },
        { type: 'header', key: 'purpose', value: 'prefetch' },
      ],
    },
  ],
};
