import { ServiceArea } from '@skydrop/db';

/**
 * Service area from an Indian pincode's postal circle.
 *
 * ── WHY THIS EXISTS ──────────────────────────────────────────────────
 * Twenty-seven pincodes were seeded — one per major city — against
 * roughly 19,000 in India. A destination with no row resolved to no
 * service area, so the zone fell back to the literal string "DEFAULT",
 * no rate card item matched it, and base shipping came out ₹0. GST is a
 * percentage of that, so the order priced at ₹0.00 total.
 *
 * Verified against production: Meerut, Rewa, Jamshedpur and Karaikudi
 * all quoted free shipping. That is most of India.
 *
 * ── WHY A PREFIX TABLE RATHER THAN 19,000 ROWS ───────────────────────
 * Importing every pincode would need a service-area tier for each, and
 * METRO/TIER1/TIER2 is a COMMERCIAL judgement about what a seller is
 * charged — not something to infer from a dataset and apply silently to
 * 19,000 destinations.
 *
 * The first two digits of an Indian pincode identify the postal circle,
 * which maps to a state. That is a fact, not a judgement, and it is
 * enough to place every pincode in a region. So:
 *
 *   - The North-East and Jammu & Kashmir / Ladakh are identified from
 *     the prefix. These matter most: they price to zone E (₹180–1580),
 *     nearly double zone D, and getting them wrong is the most
 *     expensive single error available here.
 *   - Everything else that is not explicitly listed in `pin_codes`
 *     falls to REST (zone D).
 *
 * REST is deliberate as the floor. It is the second-dearest zone, so an
 * unlisted destination errs toward charging rather than absorbing —
 * and unlike ₹0 it is a real number a seller can query and an operator
 * can correct by adding the pincode with its true tier.
 *
 * ── WHAT STAYS A HUMAN DECISION ──────────────────────────────────────
 * Which cities are METRO, TIER1 or TIER2 is NOT decided here. Those
 * come from explicit `pin_codes` rows, which always win over this
 * fallback. Adding a city to that table is how you price it properly;
 * this only decides what happens to everywhere you have not yet said
 * anything about.
 */

/**
 * Postal circles for the two regions that carry a special (dearer)
 * rate. Keyed on the first two or three digits.
 *
 * Sources are India Post's own circle allocations; the ranges below are
 * the stable ones. Where a two-digit prefix spans more than one state,
 * the three-digit entry decides.
 */
const NORTH_EAST_PREFIXES = [
  '78', // Assam
  '79', // Arunachal Pradesh, Nagaland, Manipur, Mizoram, Tripura, Meghalaya
  '737', // Sikkim
] as const;

const JAMMU_KASHMIR_PREFIXES = [
  '18', // Jammu division
  '19', // Kashmir division (194xxx is Ladakh, same special rate)
] as const;

/**
 * The service area implied by a pincode's postal circle, or REST when
 * the prefix carries no special rate.
 *
 * Returns null for anything that is not a six-digit Indian pincode —
 * the caller should treat that as unresolvable rather than guess, since
 * a malformed pincode is a data-entry problem and pricing it silently
 * would hide it.
 */
export function serviceAreaFromPincode(pinCode: string): ServiceArea | null {
  const digits = pinCode.trim();
  if (!/^[1-9][0-9]{5}$/.test(digits)) return null;

  if (NORTH_EAST_PREFIXES.some((p) => digits.startsWith(p))) {
    return ServiceArea.SPECIAL_NE;
  }
  if (JAMMU_KASHMIR_PREFIXES.some((p) => digits.startsWith(p))) {
    return ServiceArea.SPECIAL_JK;
  }
  // Everywhere we have not explicitly tiered. See the note above on why
  // this is REST and not something cheaper.
  return ServiceArea.REST;
}
