import { NextResponse, type NextRequest } from 'next/server';
import { createCspMiddleware } from '../../../packages/config/csp-middleware.mjs';

/**
 * Per-request CSP nonce.
 *
 * Admin talks only to its own origin (FE-3), so nothing extra is allowed.
 *
 * The policy itself lives in packages/config/csp-middleware.mjs so the
 * apps cannot drift. See that file for why 'strict-dynamic' is required
 * and what the nonce actually buys over the previous 'unsafe-inline'.
 */
const build = createCspMiddleware({});

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
  // the three apps by necessity, not by choice — the POLICY it guards
  // still lives in one place.
  //
  // Excluded, because none of them are documents and running middleware
  // on them would defeat caching for no security benefit: the API proxy
  // routes (JSON — a CSP protects nothing there), Next's static output
  // and image optimiser, and common asset extensions.
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
