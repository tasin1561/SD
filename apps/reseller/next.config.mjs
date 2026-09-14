import { staticSecurityHeaders, allRoutes } from '../../packages/config/security-headers.mjs';

/**
 * Next.js 15 config — apps/reseller (RS-2, reseller.skydrop.online).
 *
 * Same architecture as apps/seller and apps/admin: the `/api/*` proxy is
 * a ROUTE HANDLER at src/app/api/[...path]/route.ts (not a rewrite), so
 * API_ORIGIN is read at request time and Set-Cookie passes through
 * untouched (FE-3 / FE-4). The static security headers come from the ONE
 * shared module; the nonce CSP is set by src/middleware.ts, never here —
 * a CSP from both places is intersected by the browser and blocks Next's
 * own scripts.
 */

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  async headers() {
    return allRoutes(staticSecurityHeaders);
  },
  // Do not advertise the framework.
  poweredByHeader: false,
  serverExternalPackages: ['@skydrop/db'],
};

export default nextConfig;
