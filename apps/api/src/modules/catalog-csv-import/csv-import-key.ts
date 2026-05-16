import { randomUUID } from 'node:crypto';

/**
 * Spaces key layout for CSV import artifacts:
 *
 *   sellers/{sellerId}/csv-imports/{token}.csv              (uploaded source)
 *   sellers/{sellerId}/csv-imports/{token}.errors.csv       (error report)
 *
 * token is a uuidv4 (crypto.randomUUID) — uniqueness only, same rationale
 * as image keys (see phase-1a-debt). Strict parsing ties an upload to the
 * authenticated seller.
 */

export function buildCsvKey(sellerId: string): string {
  return `sellers/${sellerId}/csv-imports/${randomUUID()}.csv`;
}

export function errorReportKeyFor(sourceKey: string): string | null {
  const m = /^(sellers\/[^/]+\/csv-imports\/[^/]+)\.csv$/.exec(sourceKey);
  if (!m) return null;
  return `${m[1]}.errors.csv`;
}

export interface ParsedCsvKey {
  sellerId: string;
  token: string;
}

export function parseCsvKey(key: string): ParsedCsvKey | null {
  const m = /^sellers\/([^/]+)\/csv-imports\/([^/]+)\.csv$/.exec(key);
  if (!m) return null;
  const [, sellerId, token] = m;
  if (!sellerId || !token) return null;
  return { sellerId, token };
}
