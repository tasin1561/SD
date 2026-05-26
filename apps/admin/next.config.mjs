/**
 * Next.js 15 config — apps/admin.
 *
 * Same-origin /api/* proxy: the rewrite tells Next to forward any
 * /api/* request to the actual API origin. The Next.js server makes
 * the upstream call server-side; the browser only ever talks to
 * admin.skydrop.online. This is what makes the __Host-staffRefresh
 * cookie work cross-app: the cookie is bound to admin.skydrop.online
 * (where it was set), the browser sends it back to
 * admin.skydrop.online, and Next forwards it server-to-server to
 * api.skydrop.online. (FE-3 same-origin invariant.)
 *
 * NB: rewrites pass through Set-Cookie headers verbatim because Next
 * uses HTTP streaming under the hood — confirmed in CP1.6 manual
 * verification by forcing access-token expiry and watching the
 * silent /refresh land a new __Host- cookie via the proxy.
 *
 * API_ORIGIN env at build/start time controls the upstream — defaults
 * to localhost:3000 (where apps/api listens in dev). In prod, set to
 * `https://api.skydrop.online`.
 */
const API_ORIGIN = process.env.API_ORIGIN ?? 'http://localhost:3000';

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Server external packages: we don't bundle prisma/argon2 etc.
  // (the admin frontend doesn't import them; this is defensive.)
  serverExternalPackages: ['@skydrop/db'],
  async rewrites() {
    return [
      // Browser sees /api/auth/staff/login (same origin); Next
      // proxies to API_ORIGIN/auth/staff/login. The /api prefix
      // is stripped because the API mounts its routes at root.
      {
        source: '/api/:path*',
        destination: `${API_ORIGIN}/:path*`,
      },
    ];
  },
  // The admin app is dynamic — no static export.
  output: 'standalone',
};

export default nextConfig;
