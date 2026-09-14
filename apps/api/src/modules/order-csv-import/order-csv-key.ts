import { randomUUID } from 'node:crypto';

/**
 * Spaces key layout for ORDER CSV import artifacts (kept separate from
 * the catalog importer's `csv-imports/` prefix):
 *
 *   sellers/{sellerId}/order-imports/{token}.csv          (uploaded source)
 *   sellers/{sellerId}/order-imports/{token}.errors.csv   (error report)
 *
 * RS-5 — a reseller store's uploads sit one level deeper, under the store:
 *
 *   sellers/{sellerId}/order-imports/stores/{storeId}/{token}.csv
 *
 * so the seller's parser (`parseOrderCsvKey`, one path segment after
 * `order-imports/`) cannot accept a store's key, and the store's parser
 * ties an upload to ITS store, not merely its seller.
 *
 * token is a uuidv4 (uniqueness only — same rationale as image keys, see
 * phase-1a-debt). Strict parsing ties an upload to the authenticated
 * seller (or store).
 */

export function buildOrderCsvKey(sellerId: string): string {
  return `sellers/${sellerId}/order-imports/${randomUUID()}.csv`;
}

/** RS-5 — a reseller store's upload key. */
export function buildStoreOrderCsvKey(sellerId: string, storeId: string): string {
  return `sellers/${sellerId}/order-imports/stores/${storeId}/${randomUUID()}.csv`;
}

export function orderErrorReportKeyFor(sourceKey: string): string | null {
  const m = /^(sellers\/[^/]+\/order-imports\/(?:stores\/[^/]+\/)?[^/]+)\.csv$/.exec(sourceKey);
  if (!m) return null;
  return `${m[1]}.errors.csv`;
}

export interface ParsedOrderCsvKey {
  sellerId: string;
  token: string;
}

export function parseOrderCsvKey(key: string): ParsedOrderCsvKey | null {
  const m = /^sellers\/([^/]+)\/order-imports\/([^/]+)\.csv$/.exec(key);
  if (!m) return null;
  const [, sellerId, token] = m;
  if (!sellerId || !token) return null;
  return { sellerId, token };
}

export interface ParsedStoreOrderCsvKey extends ParsedOrderCsvKey {
  storeId: string;
}

/** RS-5 — parse a store's upload key; null for any other shape (a seller's included). */
export function parseStoreOrderCsvKey(key: string): ParsedStoreOrderCsvKey | null {
  const m = /^sellers\/([^/]+)\/order-imports\/stores\/([^/]+)\/([^/]+)\.csv$/.exec(key);
  if (!m) return null;
  const [, sellerId, storeId, token] = m;
  if (!sellerId || !storeId || !token || token.endsWith('.errors')) return null;
  return { sellerId, storeId, token };
}
