import { SellerStoreKind } from '@skydrop/db';

/**
 * RS-5 (ORD-7 generalised) — the ONE place a reseller store customer's
 * identity is taken off an order before a SELLER reads it.
 *
 * A reseller order belongs to the seller (their stock, their warehouse
 * slot, their courier) but its CUSTOMER belongs to the store that sold to
 * them. The seller sees where the parcel is going — city, state, PIN, the
 * country — because that is what their stock and courier costs depend on;
 * they never see who it is going to: name, phone numbers, email, the
 * street address or the landmark. Staff see everything (admin reads never
 * pass through here) and the store sees its own orders in full.
 *
 * Applied on the seller read path only — `OrderService.list` and
 * `OrderService.loadOwnedForSeller` — and pinned by
 * `reseller-privacy.spec.ts`. A CHANNEL order passes through untouched.
 */

/** What a masked order says instead of a name. */
export const HIDDEN_RECIPIENT_NAME = 'Reseller store customer';

/** Every recipient field a seller may NOT read on a reseller order, and what it becomes. */
const MASKED: Readonly<Record<string, string | null>> = {
  recipientName: HIDDEN_RECIPIENT_NAME,
  recipientPhoneE164: '',
  recipientAltPhoneE164: null,
  recipientEmail: null,
  recipientAddressLine1: '',
  recipientAddressLine2: null,
  recipientLandmark: null,
  // The customer row is the STORE's (ORD-7 generalised); its id would only
  // lead to a 404, but a seller has no business holding it either.
  customerId: null,
  customerName: null,
  customerEmail: null,
};

export type Masked<T> = T & { readonly recipientMasked: boolean };

/**
 * The order as a seller may read it. Only fields PRESENT on the row are
 * replaced — a list projection without an email stays without one — and
 * `recipientMasked` says which happened, so a screen can explain the gap
 * rather than showing a blank that looks like missing data.
 */
export function maskResellerRecipient<T extends { readonly storeKind: SellerStoreKind }>(
  row: T,
): Masked<T> {
  if (row.storeKind !== SellerStoreKind.RESELLER) return { ...row, recipientMasked: false };
  const out: Record<string, unknown> = { ...row };
  for (const [key, value] of Object.entries(MASKED)) {
    if (key in out) out[key] = value;
  }
  out.recipientMasked = true;
  return out as Masked<T>;
}
