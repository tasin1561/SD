import { randomUUID } from 'node:crypto';

/**
 * Canonical Spaces key layout for variant images:
 *
 *   sellers/{sellerId}/variants/{variantId}/{token}.{ext}            (original)
 *   sellers/{sellerId}/variants/{variantId}/thumbnails/{token}.webp  (thumbnail)
 *
 * Note: `token` is a uuidv4 generated app-side (crypto.randomUUID). The
 * spec wrote "uuidv7" but image keys need only uniqueness, not time
 * ordering, and uuidv7 has no std-lib generator — using v4 avoids a new
 * dependency. Flagged in phase-1a-debt.
 */

export const ALLOWED_IMAGE_MIME = ['image/jpeg', 'image/png', 'image/webp'] as const;
export type AllowedImageMime = (typeof ALLOWED_IMAGE_MIME)[number];

const EXT_BY_MIME: Record<AllowedImageMime, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

export function isAllowedImageMime(m: string): m is AllowedImageMime {
  return (ALLOWED_IMAGE_MIME as readonly string[]).includes(m);
}

export function buildOriginalKey(
  sellerId: string,
  variantId: string,
  mime: AllowedImageMime,
): string {
  return `sellers/${sellerId}/variants/${variantId}/${randomUUID()}.${EXT_BY_MIME[mime]}`;
}

export interface ParsedKey {
  sellerId: string;
  variantId: string;
  token: string;
  ext: string;
  isThumbnail: boolean;
}

/**
 * Strictly parse a key and return its parts, or null if it does not match
 * the canonical original-image layout (thumbnails are NOT accepted here —
 * sellers register originals only).
 */
export function parseOriginalKey(key: string): ParsedKey | null {
  const m = /^sellers\/([^/]+)\/variants\/([^/]+)\/([^/]+)\.([a-z0-9]+)$/.exec(key);
  if (!m) return null;
  const [, sellerId, variantId, token, ext] = m;
  if (!sellerId || !variantId || !token || !ext) return null;
  return { sellerId, variantId, token, ext, isThumbnail: false };
}

/** Derive the thumbnail key for a given original key (by convention). */
export function deriveThumbnailKey(originalKey: string): string | null {
  const p = parseOriginalKey(originalKey);
  if (!p) return null;
  return `sellers/${p.sellerId}/variants/${p.variantId}/thumbnails/${p.token}.webp`;
}

/** Prefix under which a seller's variant images live. */
export function variantImagePrefix(sellerId: string, variantId: string): string {
  return `sellers/${sellerId}/variants/${variantId}/`;
}

/**
 * The key to presign when showing a picture in a LIST CELL — a picker
 * row, an order line, a thumbnail grid.
 *
 * Prefer the thumbnail: these are 32-40px cells and an original can be
 * several megabytes. A non-null `thumbnailUrl` means the thumbnail job
 * ran, so the derived key exists; `deriveThumbnailKey` still returns
 * null for a key it cannot parse, and either way we fall back to the
 * original rather than dropping the picture entirely.
 *
 * Extracted because this exact expression had been written out three
 * times (variant list, variant search, image detail) and a fourth was
 * about to be added for order lines — the kind of duplication that ends
 * with one call site quietly serving full-size originals.
 */
export function displayImageKey(image: {
  readonly spacesKey: string;
  readonly thumbnailUrl: string | null;
}): string {
  return (
    (image.thumbnailUrl !== null ? deriveThumbnailKey(image.spacesKey) : null) ?? image.spacesKey
  );
}
