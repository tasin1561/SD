import { randomUUID } from 'node:crypto';

/**
 * Spaces key layout for ORDER CSV import artifacts (kept separate from
 * the catalog importer's `csv-imports/` prefix):
 *
 *   sellers/{sellerId}/order-imports/{token}.csv          (uploaded source)
 *   sellers/{sellerId}/order-imports/{token}.errors.csv   (error report)
 *
 * token is a uuidv4 (uniqueness only — same rationale as image keys, see
 * phase-1a-debt). Strict parsing ties an upload to the authenticated
 * seller.
 */

export function buildOrderCsvKey(sellerId: string): string {
  return `sellers/${sellerId}/order-imports/${randomUUID()}.csv`;
}

export function orderErrorReportKeyFor(sourceKey: string): string | null {
  const m = /^(sellers\/[^/]+\/order-imports\/[^/]+)\.csv$/.exec(sourceKey);
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
