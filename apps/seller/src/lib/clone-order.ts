import { stripSellerPrefix } from '@/lib/seller-prefix';
import type { PickedLine } from '@/components/product-picker';

/**
 * "Clone order" — open the create-order form pre-filled from an existing
 * order. NOTHING is created here: the form is submitted as usual, so every
 * validation, address check and policy applies to the copy exactly as it
 * does to a fresh order.
 *
 * What is COPIED: the recipient (name, phone, address lines, PIN), the
 * products (same variants and quantities), the payment mode and the notes.
 * What is DELIBERATELY NOT: your own order reference (it must be unique per
 * shopfront, so the copy starts empty), the order number, status, AWB, the
 * address-check result and every money figure (delivery fee, discount,
 * advance, declared value, weight). Prices are re-read from the catalogue
 * as it is NOW — an old price is never copied silently — and the collectable
 * is then worked out by the form from those prices.
 */
export const CLONE_PARAM = 'cloneFrom';

/** The create route every console links to; it picks the v1/v2 form itself. */
export function cloneHref(orderId: string): string {
  return `/orders/new?${CLONE_PARAM}=${encodeURIComponent(orderId)}`;
}

/** The slice of an order the clone reads (a structural subset of `OrderView`). */
export interface CloneSourceOrder {
  readonly orderNumber: string;
  readonly recipientName: string;
  readonly recipientPhoneE164: string;
  readonly recipientAddressLine1: string;
  readonly recipientAddressLine2: string | null;
  readonly recipientLandmark: string | null;
  readonly recipientPostalCode: string;
  readonly paymentMode: string;
  readonly sellerNotes: string | null;
  readonly items: ReadonlyArray<{
    readonly variantId: string;
    readonly skuCode: string;
    readonly quantity: number;
    readonly unitPriceInr: string | null;
  }>;
}

/** The catalogue as it is now, for one variant. */
export interface CloneCatalogueHit {
  readonly id: string;
  readonly skuCode: string;
  readonly productName: string;
  readonly variantLabel: string | null;
  readonly primaryImageUrl: string | null;
  readonly effectiveWeightGrams: number | null;
  readonly effectiveDeclaredValueInr: string | null;
}

export interface CloneFields {
  readonly recipientName: string;
  readonly recipientPhoneE164: string;
  readonly recipientAddressLine1: string;
  readonly recipientAddressLine2: string;
  readonly recipientPostalCode: string;
  readonly paymentMode: 'COD' | 'PREPAID';
  readonly sellerNotes: string;
}

export interface CloneSeed {
  readonly sourceOrderNumber: string;
  readonly fields: CloneFields;
  readonly lines: ReadonlyArray<Omit<PickedLine, 'key'>>;
  /** SKUs no longer in the catalogue — left out of the copy. */
  readonly dropped: readonly string[];
  /** SKUs whose price today differs from what the old order sold them at. */
  readonly repriced: readonly string[];
}

export function buildSellerClone(
  src: CloneSourceOrder,
  hits: ReadonlyMap<string, CloneCatalogueHit>,
  sellerInitials: string | null,
): CloneSeed {
  const lines: Array<Omit<PickedLine, 'key'>> = [];
  const dropped: string[] = [];
  const repriced: string[] = [];
  for (const it of src.items) {
    const hit = hits.get(it.variantId);
    if (hit === undefined) {
      dropped.push(it.skuCode);
      continue;
    }
    const now = hit.effectiveDeclaredValueInr ?? '';
    if (it.unitPriceInr !== null && Number(it.unitPriceInr) !== Number(now))
      repriced.push(it.skuCode);
    lines.push({
      variantId: hit.id,
      skuCode: hit.skuCode,
      productName: hit.productName,
      variantLabel: hit.variantLabel,
      imageUrl: hit.primaryImageUrl,
      weightGrams: hit.effectiveWeightGrams,
      catalogueValueInr: hit.effectiveDeclaredValueInr,
      quantity: String(it.quantity),
      unitPriceInr: now,
    });
  }
  const landmark = src.recipientAddressLine2 ?? src.recipientLandmark ?? '';
  return {
    sourceOrderNumber: src.orderNumber,
    fields: {
      // The stored name carries the seller code; the input sits behind a
      // fixed prefix box (same strip the edit form does).
      recipientName: stripSellerPrefix(sellerInitials, src.recipientName),
      recipientPhoneE164: src.recipientPhoneE164,
      recipientAddressLine1: src.recipientAddressLine1,
      recipientAddressLine2: landmark,
      recipientPostalCode: src.recipientPostalCode,
      paymentMode: src.paymentMode === 'PREPAID' ? 'PREPAID' : 'COD',
      sellerNotes: src.sellerNotes ?? '',
    },
    lines,
    dropped,
    repriced,
  };
}
