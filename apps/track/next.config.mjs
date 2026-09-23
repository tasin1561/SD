import { staticSecurityHeaders, allRoutes } from '../../packages/config/security-headers.mjs';

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Dev-only routes (the /dev/ui gallery) are `page.dev.tsx` and are
  // compiled ONLY when APPS_DEV_ROUTES=1 — a plain `next build` never sees
  // them, so nothing of theirs can reach a production chunk.
  pageExtensions:
    process.env.APPS_DEV_ROUTES === '1'
      ? ['dev.tsx', 'tsx', 'ts', 'jsx', 'js']
      : ['tsx', 'ts', 'jsx', 'js'],
  reactStrictMode: true,
  // Security response headers live in ONE shared module so the apps
  // cannot drift into different postures. See that file for why the CSP
  // is shaped the way it is — in particular why connect-src is the
  // load-bearing directive when the access token lives in JS memory.
  async headers() {
    return allRoutes(staticSecurityHeaders);
  },
  // Do not advertise the framework.
  poweredByHeader: false,
};

export default nextConfig;
