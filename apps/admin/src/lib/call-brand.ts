import type { PulledAssignment } from '@skydrop/api-client';

/**
 * RS-10 — the "Ordered from …" line on the call screen.
 *
 * The server decides whom an order presents as (`customerFacingBrand`,
 * one rule for every customer surface) and sends it as `customerBrand`.
 * This only picks what to print: the server's answer, else — when it
 * could not be read (fail-open) — the seller company the screen always
 * showed. A channel order therefore reads exactly as before.
 */
export function callBrandLine(
  seller: PulledAssignment['seller'],
  customerBrand: NonNullable<PulledAssignment['customerBrand']> | null,
): { readonly orderedFrom: string | null; readonly isReseller: boolean } {
  const isReseller = customerBrand?.kind === 'RESELLER_STORE';
  const orderedFrom = isReseller
    ? customerBrand.name
    : (customerBrand?.name ?? seller?.companyName ?? null);
  return { orderedFrom, isReseller };
}
