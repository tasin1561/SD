/**
 * The seller code carried on the recipient name.
 *
 * A parcel's recipient name is stored as `<initials> <name>` — "MSt John
 * Doe" — so that the seller a parcel belongs to is legible wherever the
 * name appears: the courier waybill, the packing bench, a warehouse
 * search, a call the agent is about to make.
 *
 * ── WHY BOTH DIRECTIONS EXIST ────────────────────────────────────────
 * That single field is read by three audiences with different needs.
 * The COURIER LABEL wants the code — that is the whole point. The
 * CUSTOMER must never see it: an order confirmation opening "Hello MSt
 * John Doe" reads as a system error to the person we are asking to pay
 * cash at their door. The GST INVOICE must not carry it either; the
 * buyer on a tax document is a person, not a person plus our internal
 * routing code.
 *
 * So the prefix goes on at the boundary where the order is written, and
 * comes off at the two boundaries that face the customer. Anything that
 * grows a third customer-facing use of `recipientName` must call
 * `stripSellerPrefix` too.
 *
 * ── IDEMPOTENT ON PURPOSE ────────────────────────────────────────────
 * `compose` is safe to apply twice. An order can be created and then
 * PATCHed with a name that already carries the prefix (the seller's edit
 * form round-trips it), and a CSV re-upload re-submits whatever was
 * stored last time. Prefixing blindly would give "MSt MSt John Doe" and
 * the second application is invisible until it is on a label.
 */

/** Seller initials are 2-4 alphanumerics — see seller-initials.ts. */
function prefixOf(initials: string | null | undefined): string | null {
  const trimmed = initials?.trim() ?? '';
  return trimmed === '' ? null : trimmed;
}

/**
 * `("MSt", "John Doe")` → `"MSt John Doe"`. Returns the name untouched
 * when the seller has no code yet — a seller predating the initials
 * column must still be able to place an order.
 */
export function composeSellerPrefixedName(
  initials: string | null | undefined,
  name: string,
): string {
  const prefix = prefixOf(initials);
  const clean = name.trim();
  if (prefix === null) return clean;
  // Case-insensitive: an operator retyping "mst john doe" should not
  // produce "MSt mst john doe".
  if (clean.toLowerCase().startsWith(`${prefix.toLowerCase()} `)) {
    return `${prefix}${clean.slice(prefix.length)}`;
  }
  return `${prefix} ${clean}`;
}

/**
 * `("MSt", "MSt John Doe")` → `"John Doe"`. Only strips a LEADING,
 * space-separated, exact match of this seller's own code — never a
 * name that merely begins with the same letters ("MSt" must not eat
 * the "Mst" of a customer actually called that, which is why the
 * separator is required).
 */
export function stripSellerPrefix(initials: string | null | undefined, name: string): string {
  const prefix = prefixOf(initials);
  const clean = name.trim();
  if (prefix === null) return clean;
  if (!clean.toLowerCase().startsWith(`${prefix.toLowerCase()} `)) return clean;
  return clean.slice(prefix.length + 1).trim();
}
