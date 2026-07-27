import { adminSecurityHeaders, allRoutes } from '../../packages/config/security-headers.mjs';

/**
 * Next.js 15 config — apps/admin.
 *
 * The same-origin /api/* proxy is implemented as a ROUTE HANDLER at
 * src/app/api/[...path]/route.ts (NOT a rewrite). Route handlers
 * evaluate env at REQUEST time, so API_ORIGIN can change between
 * builds + restarts without rebuilding the Next config bundle. They
 * also give explicit control over Set-Cookie passthrough, which is
 * the load-bearing concern of the SSR-auth model.
 *
 * (Rewrites would also work — Next does pass cookies through — but
 * bakes the destination URL into the build artifact. The route
 * handler is more flexible and is what the M12 CP1 verification was
 * exercised against.)
 */

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Security response headers live in ONE shared module so the apps
  // cannot drift into different postures. See that file for why the CSP
  // is shaped the way it is — in particular why connect-src is the
  // load-bearing directive when the access token lives in JS memory.
  async headers() {
    return allRoutes(adminSecurityHeaders);
  },
  // Do not advertise the framework.
  poweredByHeader: false,
  // Server external packages: we don't bundle prisma/argon2 etc.
  // (the admin frontend doesn't import them; this is defensive.)
  serverExternalPackages: ['@skydrop/db'],
};

export default nextConfig;
