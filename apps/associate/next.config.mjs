import { staticSecurityHeaders, allRoutes } from '../../packages/config/security-headers.mjs';

/**
 * Next.js 15 config — apps/associate (ASSOC-1, portal.skydrop.global).
 *
 * Same architecture as the other four consoles: the `/api/*` proxy is a
 * ROUTE HANDLER at src/app/api/[...path]/route.ts (not a rewrite), so
 * API_ORIGIN is read at request time and Set-Cookie passes through
 * untouched (FE-3 / FE-4). The static security headers come from the ONE
 * shared module; the nonce CSP is set by src/middleware.ts, never here —
 * a CSP from both places is intersected by the browser and blocks Next's
 * own scripts.
 *
 * ── THE PORT IS 3007, NOT 3006 ──────────────────────────────────────
 * 3006 is apps/marketing (`next dev -p 3006`, and MARKETING_PORT in the
 * root playwright.config.ts). Two apps on one port collide in `pnpm dev`
 * and in Playwright's webServer array, where the second to boot finds the
 * first already answering and silently runs every spec against the wrong
 * site. The ports in use are 3000 api · 3002 admin · 3003 seller ·
 * 3004 track · 3005 reseller · 3006 marketing, so this one is 3007.
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
