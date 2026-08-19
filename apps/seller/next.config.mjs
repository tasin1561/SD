import { staticSecurityHeaders, allRoutes } from '../../packages/config/security-headers.mjs';

/**
 * Next.js 15 config — apps/seller.
 *
 * Same architecture as apps/admin: the `/api/*` proxy is a ROUTE
 * HANDLER at src/app/api/[...path]/route.ts (NOT a rewrite). Route
 * handlers evaluate env at REQUEST time, so API_ORIGIN can change
 * between builds + restarts without rebuilding. They also give
 * explicit control over Set-Cookie passthrough, the load-bearing
 * concern of the SSR-auth model (FE-3 / FE-4).
 */

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Security response headers live in ONE shared module so the apps
  // cannot drift into different postures. See that file for why the CSP
  // is shaped the way it is — in particular why connect-src is the
  // load-bearing directive when the access token lives in JS memory.
  async headers() {
    return allRoutes(staticSecurityHeaders);
  },
  /**
   * /catalog moved to /products (2026-08-19).
   *
   * The section was renamed to what a seller calls it, and the address
   * followed. This keeps the old one working: a bookmark, a link in an
   * email we already sent, or a browser autocompleting the URL somebody
   * typed for weeks. Permanent, so it is cached and search engines stop
   * asking — nothing here is coming back to /catalog.
   *
   * Path-preserving, so a deep link lands on the same page it used to:
   * /catalog/products/<id> is the one exception, because the redundant
   * "products" segment was dropped in the same move.
   */
  async redirects() {
    return [
      { source: '/catalog/products/:path*', destination: '/products/:path*', permanent: true },
      { source: '/catalog', destination: '/products', permanent: true },
      { source: '/catalog/:path*', destination: '/products/:path*', permanent: true },
    ];
  },
  // Do not advertise the framework.
  poweredByHeader: false,
  // Server external packages: we don't bundle prisma/argon2 etc.
  // (the seller frontend doesn't import them; this is defensive.)
  serverExternalPackages: ['@skydrop/db'],
};

export default nextConfig;
