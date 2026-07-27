/** @type {import('next').NextConfig} */
const nextConfig = {
  // Pure static export — deployable to any static host (OpenLiteSpeed,
  // Caddy file_server, S3+CloudFront). No runtime server features.
  output: 'export',
  reactStrictMode: true,
  images: {
    // next/image with the default loader needs a Next.js server for
    // on-the-fly optimization. With output: 'export' we serve
    // pre-generated images from /public, so disable the optimizer.
    unoptimized: true,
  },
  // Strip Next.js "powered by" header in the static HTML.
  poweredByHeader: false,

  // NOTE — no `headers()` here, and adding one would do nothing.
  // `output: 'export'` produces files with no Node process in front of
  // them, so Next never gets a chance to set a response header. The
  // other three apps set theirs in `packages/config/security-headers.mjs`
  // plus a nonce CSP in middleware; this one's headers have to come from
  // whatever serves the files. The Nginx snippet is checked in at
  // `docs/nginx-security-headers.conf`.
};

export default nextConfig;
