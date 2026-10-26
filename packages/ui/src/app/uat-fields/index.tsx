'use client';

/**
 * Fields the client asked to have taken off a form during UAT.
 *
 * ── WHY THE CODE IS STILL HERE ───────────────────────────────────────
 * The owner's rule for UAT: a thing the client asks to remove is HIDDEN,
 * never deleted. UAT opinions change weekly, and a field deleted in
 * October is a field somebody has to rebuild in November from memory,
 * including the validation and the money arithmetic hanging off it. So
 * every input below still exists, still has its state, and still sends
 * what it always sent when it is shown.
 *
 * ── WHY A HOOK AND NOT A CONSTANT ────────────────────────────────────
 * These move to the UAT Settings screen, where the owner turns them on
 * and off without a deploy. That means the answer becomes a server
 * value fetched per session — a hook today, even though today it
 * returns a literal, is what makes that change ONE edit in this file
 * rather than seven edits across three consoles. A `const` read at
 * module scope could not become a fetch without rewriting every call
 * site, which is exactly the hunt this exists to avoid.
 *
 * When UAT Settings lands, the body of `useUatField` reads the setting
 * (cached, defaulting to the literal below if it cannot be read) and
 * nothing else in the estate changes.
 *
 * ── WHAT HIDING ACTUALLY DOES ────────────────────────────────────────
 * The field is not rendered, so it stays at its initial value and the
 * payload builder omits it — which lands on the same server defaults
 * the API has always applied to an order that did not state one:
 *
 *   - delivery fee  → absent → 0, and 0 is already the system default
 *                     (`orders.default_customer_delivery_fee_inr`, set
 *                     to 0 on 2026-10-26).
 *   - discount      → absent → 0. It was used on 0 of 53 live orders.
 *   - declared value→ absent → the server computes
 *                     Σ(resolved declared value × quantity) from the
 *                     catalogue, which is what the field's own
 *                     placeholder ("Sum of the line values") promised.
 *                     Verified: every live order has a non-zero value.
 *
 * ── THE ONE RISK, STATED ─────────────────────────────────────────────
 * Declared value is the CUSTOMS figure and the e-waybill trigger above
 * ₹50,000. With the field hidden, a product carrying no declared value
 * at either the variant or the product level would declare ₹0 and no
 * operator could see it, let alone correct it. All three live products
 * carry a default today. If that stops being true, this flag is the
 * thing to turn back on.
 */

/** Every field UAT can take off a form. Add here, then use the hook. */
export type UatField = 'orderDeliveryFee' | 'orderDiscount' | 'orderDeclaredValue';

/**
 * Shown or hidden, today. `false` means hidden.
 *
 * Owner, 2026-10-26: all three off for UAT, to be reversible from the
 * UAT Settings screen once it exists.
 */
const SHOWN_TODAY: Readonly<Record<UatField, boolean>> = {
  orderDeliveryFee: false,
  orderDiscount: false,
  orderDeclaredValue: false,
};

/**
 * Whether a UAT-controlled field should be rendered.
 *
 * Call it at the top of a component like any other hook — never inside
 * a condition — so the call sites do not have to change when this
 * starts fetching.
 */
export function useUatField(field: UatField): boolean {
  return SHOWN_TODAY[field];
}
