import type { StoreCatalogueItem } from '@/lib/catalogue-hooks';

/**
 * "Clone order" — open the order form pre-filled from an existing order.
 * NOTHING is created until the form is submitted as usual, so every
 * validation, address check and policy applies to the copy.
 *
 * COPIED: recipient (name, phone, email, address, landmark, PIN), the
 * products (same variants and quantities), payment mode and notes.
 * NOT COPIED: your own order reference (must be unique, so it starts empty),
 * order number, status, AWB, the address-check result, the delivery fee and
 * every charge. A retail price is kept only while it is still inside the
 * catalogue's range TODAY — otherwise it is cleared to the suggested price
 * and flagged, never copied silently. The COD amount is copied only when
 * nothing had to change, so it can never disagree with the lines.
 */
export const CLONE_PARAM = 'cloneFrom';

export function cloneHref(orderId: string): string {
  return `/orders/new?${CLONE_PARAM}=${encodeURIComponent(orderId)}`;
}

export interface CloneSourceOrder {
  readonly orderNumber: string;
  readonly recipient: {
    readonly name: string;
    readonly phoneE164: string;
    readonly email: string | null;
    readonly addressLine1: string;
    readonly addressLine2: string | null;
    readonly landmark: string | null;
    readonly postalCode: string;
  };
  readonly paymentMode: 'COD' | 'PREPAID';
  readonly codAmountInr: string | null;
  readonly deliveryFeeInr: string | null;
  readonly notes: string | null;
  readonly lines: ReadonlyArray<{
    readonly variantId: string;
    readonly skuCode: string;
    readonly quantity: number;
    readonly retailUnitInr: string | null;
  }>;
}

export interface CloneSeed {
  readonly sourceOrderNumber: string;
  readonly fields: {
    readonly name: string;
    readonly phone: string;
    readonly email: string;
    readonly line1: string;
    readonly landmark: string;
    readonly pin: string;
    readonly notes: string;
    readonly payment: 'COD' | 'PREPAID';
    readonly codAmount: string;
  };
  readonly lines: ReadonlyArray<{
    readonly variantId: string;
    readonly quantity: string;
    readonly retail: string;
  }>;
  /** SKUs no longer in the catalogue — left out of the copy. */
  readonly dropped: readonly string[];
  /** SKUs whose old retail price is outside today's range — reset to the suggestion. */
  readonly repriced: readonly string[];
}

function inRange(price: number, item: StoreCatalogueItem): boolean {
  if (!Number.isFinite(price)) return false;
  if (item.minRetailInr !== null && price < Number(item.minRetailInr)) return false;
  if (item.maxRetailInr !== null && price > Number(item.maxRetailInr)) return false;
  return true;
}

export function buildStoreClone(
  src: CloneSourceOrder,
  catalogue: ReadonlyArray<StoreCatalogueItem>,
): CloneSeed {
  const byId = new Map(catalogue.map((i) => [i.variantId, i]));
  const lines: Array<{ variantId: string; quantity: string; retail: string }> = [];
  const dropped: string[] = [];
  const repriced: string[] = [];
  for (const l of src.lines) {
    const item = byId.get(l.variantId);
    if (item === undefined) {
      dropped.push(l.skuCode);
      continue;
    }
    const old = l.retailUnitInr;
    if (old !== null && inRange(Number(old), item)) {
      lines.push({ variantId: l.variantId, quantity: String(l.quantity), retail: String(old) });
    } else {
      repriced.push(l.skuCode);
      lines.push({
        variantId: l.variantId,
        quantity: String(l.quantity),
        retail: item.suggestedRetailInr ?? '',
      });
    }
  }
  const untouched = dropped.length === 0 && repriced.length === 0;
  const noFee = src.deliveryFeeInr === null || Number(src.deliveryFeeInr) === 0;
  return {
    sourceOrderNumber: src.orderNumber,
    fields: {
      name: src.recipient.name,
      phone: src.recipient.phoneE164,
      email: src.recipient.email ?? '',
      line1: src.recipient.addressLine1,
      landmark: src.recipient.addressLine2 ?? src.recipient.landmark ?? '',
      pin: src.recipient.postalCode,
      notes: src.notes ?? '',
      payment: src.paymentMode,
      codAmount:
        src.paymentMode === 'COD' && untouched && noFee && src.codAmountInr !== null
          ? String(Number(src.codAmountInr))
          : '',
    },
    lines,
    dropped,
    repriced,
  };
}
