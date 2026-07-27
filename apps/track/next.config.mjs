import { trackSecurityHeaders, allRoutes } from '../../packages/config/security-headers.mjs';

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Security response headers live in ONE shared module so the apps
  // cannot drift into different postures. See that file for why the CSP
  // is shaped the way it is — in particular why connect-src is the
  // load-bearing directive when the access token lives in JS memory.
  async headers() {
    return allRoutes(trackSecurityHeaders);
  },
  // Do not advertise the framework.
  poweredByHeader: false,
};

export default nextConfig;
