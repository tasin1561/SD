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
};

export default nextConfig;
