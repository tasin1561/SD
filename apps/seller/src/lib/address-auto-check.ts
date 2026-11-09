/**
 * When the order page asks Solustation about an address without being
 * told to.
 *
 * The rule lives here rather than inline in the effect because it is
 * the part with consequences: it decides how often a paid third party
 * is called from a form somebody is typing into. An effect body re-runs
 * on every render, so "ask when the address is ready" is one keystroke
 * away from "ask on every render" if a condition is lost in an edit.
 *
 * Billing is one unit per reference id per month — a repeat question on
 * the same draft goes down their corrections path and costs nothing
 * more — so what these rules protect is their rate limit, our latency,
 * and an operator's patience. Not a bill.
 *
 * FE-2: none of this is a gate. It changes WHEN the verdict is fetched
 * and nothing about what the verdict means or what it permits.
 */

/**
 * The question, as a single comparable string.
 *
 * Payment type is in the key because it is in the request: the RTO risk
 * they return differs for COD, so switching the payment mode makes the
 * previous answer an answer to a different question.
 */
export function addressCheckKey(
  pincode: string,
  paymentType: 'cod' | 'prepaid',
  address: string,
): string {
  return `${pincode}|${paymentType}|${address}`;
}

export interface AutoCheckInput {
  /** The form's own "there is enough here to check" test. */
  readonly canCheck: boolean;
  /** Line 2, the landmark, exactly as typed. */
  readonly addressLine2: string;
  /** A check is already in flight. */
  readonly busy: boolean;
  /** The key of the last question actually sent, or null for none. */
  readonly lastAsked: string | null;
  /** The key of the question the form would ask now. */
  readonly key: string;
}

/**
 * Four conditions, each load-bearing:
 *
 *  - `canCheck` — the form's existing bar: a draft reference, three
 *    characters of address, a well-formed PIN.
 *  - LINE 2 PRESENT. `canCheck` is satisfied by line 1 alone, which is
 *    the right bar for a button somebody chose to press and too low for
 *    a question nobody asked for: line 2 is the landmark, and it is
 *    what lifts a verdict out of "no landmark". Asking before it exists
 *    spends a round trip on an answer known in advance to be partial.
 *  - NOT BUSY — one question at a time; the effect re-runs when the
 *    answer lands and re-decides then.
 *  - NOT ALREADY ASKED — the dedupe. Most renders of this form have
 *    nothing to do with the address (a product added, a checkbox
 *    ticked) and must not re-ask.
 */
export function shouldAutoCheck(input: AutoCheckInput): boolean {
  if (!input.canCheck) return false;
  if (input.addressLine2.trim() === '') return false;
  if (input.busy) return false;
  return input.lastAsked !== input.key;
}

/**
 * How long the address has to sit still first.
 *
 * Long enough that typing a landmark is one question and not eight;
 * short enough that an operator who has finished and moved to the
 * product list sees the verdict before they have chosen anything. Just
 * under a second reads as "it noticed" rather than "it is fighting me".
 */
export const AUTO_CHECK_PAUSE_MS = 900;

/**
 * The fields that make up address line 1, in the order the field's own
 * hint asks a seller to type them.
 *
 * `landmark` is absent ON PURPOSE — it is line 2's job, and including
 * it is the whole bug this list exists to avoid. `state` and `pincode`
 * are absent because the PIN field owns them and a line 1 ending "West
 * Bengal 700128" prints the PIN on the parcel twice.
 */
const LINE_1_FIELDS = [
  'house',
  'street',
  'locality',
  'village_city',
  'post_office',
  'police_station',
  'district',
] as const;

/**
 * Fields we will repeat back to the operator.
 *
 * `inferred` is excluded, which is the point of reading `field_source`
 * at all. Probed live 2026-11-09: a typed "Raydighi" came back as
 * `village_city: "Raydighi Abad"` marked `inferred`. Writing that into
 * the form would be us quietly rewording the customer's own address
 * and then showing it to the operator as theirs. `customer` is what
 * they said; `pincode` is what the PIN decides and is not in dispute.
 */
const TRUSTED_SOURCES: ReadonlySet<string> = new Set(['customer', 'pincode']);

/** Their `post_office` / `police_station` read as an address line when
 *  they carry the prefix a label would print. */
const FIELD_PREFIX: Readonly<Record<string, string>> = {
  post_office: 'PO ',
  police_station: 'PS ',
};

/**
 * Address line 1, composed from the fields they extracted.
 *
 * ── WHY NOT `completed_address` ───────────────────────────────────────
 * Because it always contains the landmark, and line 2 IS the landmark
 * here (ORD-5) — so applying their sentence duplicated it onto the
 * parcel. Verified live on 2026-11-09: sending the landmark as its own
 * field does not keep it out of their completed address, so there was
 * no way to fix this by asking them differently. Composing from the
 * fields leaves the landmark out because it is a field we do not
 * select, not a substring we try to delete afterwards — which is the
 * version that still works when they normalise "Near City Hosp." into
 * "Near City Hospital" and a subtraction would miss.
 *
 * Returns '' when nothing trustworthy came back, which the caller reads
 * as "no suggestion to offer" — so the operator keeps what they typed.
 */
export function suggestedAddressLine1(
  extracted: Readonly<Record<string, string | null>> | null | undefined,
  fieldSource?: Readonly<Record<string, string>> | null | undefined,
): string {
  if (extracted === null || extracted === undefined) return '';
  const parts: string[] = [];
  for (const field of LINE_1_FIELDS) {
    const value = (extracted[field] ?? '').trim();
    if (value === '') continue;
    // No `field_source` at all (an older response, a stub) means we
    // cannot tell inferred from typed — so take the value rather than
    // refuse everything. A missing map is not evidence of a guess.
    if (fieldSource !== null && fieldSource !== undefined) {
      const source = fieldSource[field];
      if (source !== undefined && !TRUSTED_SOURCES.has(source)) continue;
    }
    parts.push(`${FIELD_PREFIX[field] ?? ''}${value}`);
  }
  return parts.join(', ');
}

/**
 * Would taking their composition LOSE something the operator typed?
 *
 * Their extraction is not lossless — probed live 2026-11-09, a typed
 * "H.No 12" came back as `house: "12"`, and `street` was null against
 * an address that had no street to give. Replacing line 1 with a
 * composition that has quietly dropped a word is worse than leaving it
 * alone, because the operator sees a tidier line and no sign anything
 * went missing.
 *
 * So: every run of letters and digits in the current line 1 must still
 * appear somewhere in the suggestion. Compared as normalised tokens, so
 * punctuation and case cannot trip it — only an actually absent word.
 */
export function suggestionKeepsEverything(suggested: string, currentLine1: string): boolean {
  const tokens = (s: string): string[] =>
    s
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((t) => t !== '');
  const have = new Set(tokens(suggested));
  return tokens(currentLine1).every((t) => have.has(t));
}

/**
 * Is their suggestion worth offering over what the operator typed?
 *
 * Only when it says something different. Comparison ignores case,
 * spacing and trailing punctuation, because "offering" an address that
 * differs from the current one by a comma is noise with an Undo button
 * attached — and, worse, applying it would change the text, which
 * starts another check, which returns the same suggestion again.
 */
export function suggestionIsWorthOffering(suggested: string, currentLine1: string): boolean {
  const flat = (s: string): string =>
    s
      .toLowerCase()
      .replace(/[\s,]+/g, ' ')
      .trim();
  return suggested !== '' && flat(suggested) !== flat(currentLine1);
}
