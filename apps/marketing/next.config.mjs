/** @type {import('next').NextConfig} */
const nextConfig = {
  // Pure static export — deployable to any static host (OpenLiteSpeed,
  // Caddy file_server, S3+CloudFront). No runtime server features.
  output: 'export',
  reactStrictMode: true,
  // Dev-only routes (`page.dev.tsx` — the swatch page, later the motion
  // gallery and the poster renderer) exist only when MARKETING_DEV_ROUTES=1
  // is set at build/dev time. A static export renders EVERY route it can
  // see, so "not in production" has to mean "not compiled": the plain
  // `next build` that CI and deploy.sh run never lists `dev.tsx` here, and
  // the route is simply not part of the app. `pnpm dev` sets the flag.
  pageExtensions:
    process.env.MARKETING_DEV_ROUTES === '1' ? ['dev.tsx', 'tsx', 'ts'] : ['tsx', 'ts'],
  images: {
    // next/image with the default loader needs a Next.js server for
    // on-the-fly optimization. With output: 'export' we serve
    // pre-generated images from /public, so disable the optimizer.
    unoptimized: true,
  },
  // Strip Next.js "powered by" header in the static HTML.
  poweredByHeader: false,
  experimental: {
    // ONE stylesheet instead of one per client component (eight on the home
    // page, each a render-blocking round trip). `scripts/critical-css.mjs`
    // (postbuild) then inlines the above-the-fold rules and loads this one
    // file without blocking render.
    cssChunking: false,
  },

  // NOTE — no `headers()` here, and adding one would do nothing.
  // `output: 'export'` produces files with no Node process in front of
  // them, so Next never gets a chance to set a response header. The
  // other three apps set theirs in `packages/config/security-headers.mjs`
  // plus a nonce CSP in middleware; this one's headers have to come from
  // whatever serves the files — Caddy, in production. The block to paste
  // into the Caddyfile is `docs/caddy-security-headers.md`.
};

export default nextConfig;
