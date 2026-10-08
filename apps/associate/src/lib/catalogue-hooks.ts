'use client';

import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { useApiClient } from '@skydrop/auth/client';

/**
 * ASSOC-1 — what THIS person may sell, at THEIR price.
 *
 * `GET /store/catalogue/sell` (permission `catalogue.sell`) is the
 * store's catalogue with the STORE'S COST REMOVED and the associate's own
 * retail in its place. It is a second endpoint rather than a filter
 * inside `GET /store/catalogue`, which carries `transferPriceInr` — what
 * the store pays its seller, and therefore the spread the store makes on
 * this person. A filter is something somebody has to remember on every
 * new field; a separate projection behind a separate permission cannot be
 * reached at all.
 *
 * ── WHAT IS NOT IN THIS TYPE, AND WHY THAT IS THE POINT ─────────────
 * No `transferPriceInr`, no suggested retail, no retail RANGE, no hidden
 * share, no set-aside — the server sends none of them, and this type
 * declares none either, so there is nothing a page could render even if
 * one came back. `src/tests/no-store-cost.test.ts` sweeps this app's
 * sources for the names, so re-adding one fails a test rather than
 * shipping quietly. (`description` is on the wire and deliberately left
 * out: nothing here shows it, and a field in a type is an invitation.)
 *
 * The field names are the SERVER's (`title`, `variantLabel`,
 * `imageUrls`), not prettier local ones. A hand-written client type that
 * renames a field is a type that silently stops matching the day the
 * endpoint changes — and renaming it here would mean every screen reads
 * a name that appears nowhere in the API.
 */
export interface SellCatalogueItem {
  readonly variantId: string;
  readonly skuCode: string;
  /** The store's own name for it where it set one, else the product's. */
  readonly title: string;
  readonly variantLabel: string | null;
  /** Presigned and short-lived; empty when the product has no picture. */
  readonly imageUrls: readonly string[];
  /**
   * What THIS person sells it for — their own `associate_prices` row.
   * NULL means no row: the product is shown, NAMED, and cannot be added
   * to an order, because there is no fallback and no markup rule. A
   * price nobody chose is worse than no price.
   */
  readonly retailPriceInr: string | null;
  /** RS-3's visible stock, unchanged — the same figure the store sees. */
  readonly availableQuantity: number;
}

export interface SellCatalogue {
  readonly items: readonly SellCatalogueItem[];
  /** How many they have no price for, and so cannot sell. The SERVER's count. */
  readonly unpricedCount: number;
}

export const SELL_CATALOGUE_KEY = ['sell-catalogue'] as const;

export function useSellCatalogue(enabled = true): UseQueryResult<SellCatalogue> {
  const client = useApiClient();
  return useQuery({
    queryKey: SELL_CATALOGUE_KEY,
    enabled,
    queryFn: () => client.request<SellCatalogue>('/api/store/catalogue/sell'),
  });
}

/** One line of the picker: "Kurta · Blue (SKU-1)". */
export function itemLabel(i: SellCatalogueItem): string {
  return i.variantLabel === null
    ? `${i.title} (${i.skuCode})`
    : `${i.title} · ${i.variantLabel} (${i.skuCode})`;
}

/** The first picture, or null — `ProductThumb` takes `string | null`. */
export function itemThumb(i: SellCatalogueItem): string | null {
  return i.imageUrls[0] ?? null;
}
