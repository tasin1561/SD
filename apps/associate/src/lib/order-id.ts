/**
 * Is this path segment shaped like an order id?
 *
 * ── WHY THE PAGE ASKS BEFORE THE API DOES ────────────────────────────
 * `/orders/[id]` matches ANY segment, so `/orders/v2` — a URL somebody
 * guessed, or an old link — reached the API as an order id and came
 * back as `Validation failed (uuid v 7 is expected)`. That sentence is
 * written for whoever called the endpoint, not for a seller who
 * mistyped a URL, and it reads as a fault in the product rather than a
 * page that is not there.
 *
 * This is COSMETIC (FE-2): the API's `ParseUUIDPipe` is still the
 * boundary and still refuses anything malformed. All this decides is
 * whether the person sees a 404 page or an error card.
 *
 * Deliberately shape-only — v7, the version every id in this system is
 * minted as. Whether an order EXISTS, and whether it is yours, stay
 * the server's answer.
 */
const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function looksLikeOrderId(id: string): boolean {
  return UUID_V7.test(id.trim());
}
