import { SellerStoreKind } from '@skydrop/db';

/**
 * RS-10 — WHO the customer bought from, decided in ONE place.
 *
 * A reseller store (`seller_stores.kind = RESELLER`, RS-1) is a separate
 * business selling ONE seller's stock under its OWN name (owner decision
 * 4: "the customer sees the STORE's name"). Every surface that shows a
 * customer — or somebody talking to a customer — who the order is from
 * asks this function, so the rule cannot drift between the call screen,
 * the courier's "sold by", the tracking page, the customer emails and
 * our own printed label:
 *
 *   - an order on a RESELLER store presents as THAT STORE: the name the
 *     order carried when it was placed (`orders.store_name_snapshot`,
 *     ORD-6 — renaming the store later must not rewrite what a past
 *     customer was told), and the store's CURRENT logo key (a logo is
 *     read live and presigned on read; nothing in the bucket is public);
 *   - every other order — a CHANNEL store, which is every order that
 *     existed before RS-1 — presents exactly as before: the seller's
 *     company.
 *
 * ── A RESELLER ORDER NEVER FALLS BACK TO THE SELLER ──────────────────
 * The customer must not learn the underlying seller. So the reseller
 * branch falls back through the store's own names (snapshot → display
 * name → name), never to `seller.companyName`, even if every one of
 * those were blank — which the schema does not allow (`store_name_snapshot`
 * and `seller_stores.name` are NOT NULL).
 *
 * Pure: no Prisma, no DI, no module. It sits in `common/` so any module
 * can use it without importing another domain (the R3 rule — a shared
 * primitive depends on nothing).
 */

/**
 * The Prisma select, on an ORDER, that answers the question. Spread it
 * into the caller's own `order: { select: … }` so every surface reads the
 * same columns.
 */
export const CUSTOMER_BRAND_ORDER_SELECT = {
  storeNameSnapshot: true,
  store: { select: { kind: true, displayName: true, name: true, logoKey: true } },
  seller: { select: { companyName: true } },
} as const;

/** What `CUSTOMER_BRAND_ORDER_SELECT` loads, tolerant of a partial row. */
export interface CustomerBrandSource {
  readonly storeNameSnapshot?: string | null;
  readonly store?: {
    readonly kind: SellerStoreKind;
    readonly displayName?: string | null;
    readonly name?: string | null;
    readonly logoKey?: string | null;
  } | null;
  readonly seller?: { readonly companyName?: string | null } | null;
}

export type CustomerFacingBrand =
  | {
      /** The order was sold by a reseller store; present the STORE. */
      readonly kind: 'RESELLER_STORE';
      readonly name: string;
      /** A Spaces KEY (never a URL). Presign it on read; fail open. */
      readonly logoKey: string | null;
    }
  | {
      /** Every other order: the seller's company, exactly as before. */
      readonly kind: 'SELLER';
      readonly name: string | null;
    };

function nonBlank(v: string | null | undefined): string | null {
  const t = v?.trim();
  return t === undefined || t === '' ? null : t;
}

export function customerFacingBrand(src: CustomerBrandSource): CustomerFacingBrand {
  if (src.store?.kind === SellerStoreKind.RESELLER) {
    return {
      kind: 'RESELLER_STORE',
      name:
        nonBlank(src.storeNameSnapshot) ??
        nonBlank(src.store.displayName) ??
        nonBlank(src.store.name) ??
        // Unreachable by schema (both names are NOT NULL). Still never
        // the seller's company — a neutral word rather than a leak.
        'Store',
      logoKey: nonBlank(src.store.logoKey),
    };
  }
  return { kind: 'SELLER', name: src.seller?.companyName ?? null };
}

/** True when the order was sold by a reseller store (RS-1). */
export function isResellerOrder(src: Pick<CustomerBrandSource, 'store'>): boolean {
  return src.store?.kind === SellerStoreKind.RESELLER;
}
