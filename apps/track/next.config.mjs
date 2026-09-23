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
  // Every track screen is built from @skydrop/ui/app primitives, and each
  // primitive's stylesheet would otherwise ship as its own render-blocking
  // <link> — six of them on the parcel page, which doubled first paint on
  // Slow 4G. The whole app's CSS is small (≈17 KB gz), so it is inlined
  // into the HTML instead: one request, nothing blocking. The CSP already
  // allows inline styles (style-src 'unsafe-inline').
  experimental: {
    inlineCss: true,
  },
  // Next 15 streams <head> metadata into the body for browsers it does not
  // recognise as crawlers, so a real browser (and Lighthouse) saw a head
  // with no description. Render it in the head for everyone: the parcel
  // page already waits for its lookup before sending a byte.
  htmlLimitedBots: /.*/,
};

export default nextConfig;
