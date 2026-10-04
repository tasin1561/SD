import type { MetadataRoute } from 'next';

/** Only the lookup page is worth indexing; parcel pages are noindex. */
export default function sitemap(): MetadataRoute.Sitemap {
  return [{ url: 'https://track.skydrop.global/', changeFrequency: 'monthly', priority: 1 }];
}
