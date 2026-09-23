import type { MetadataRoute } from 'next';

/**
 * robots.txt — a real route. Without it `/robots.txt` fell through to the
 * `[awb]` page: an API lookup for an AWB called "robots.txt" and an HTML
 * not-found page where crawlers expect plain text.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: '*', allow: '/' },
    sitemap: 'https://track.skydrop.online/sitemap.xml',
  };
}
