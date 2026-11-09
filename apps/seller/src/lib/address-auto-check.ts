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
 * Their completed address, trimmed to what address line 1 should hold.
 *
 * They return ONE string with everything in it — the customer's words,
 * the post office and police station they resolved, then the district,
 * the state and the PIN. The form does not store a state and keeps the
 * PIN in its own field, so the tail has to come off: a line 1 ending
 * "West Bengal 700128" puts the PIN on the parcel twice and asks the
 * operator to maintain the same fact in two places.
 *
 * The rule is positional, not a list of state names: drop the final
 * comma-separated part IF it ends in a six-digit code. That part is
 * "<State> <PIN>" in every answer seen so far, and when it is not —
 * when there is no PIN at the end at all — nothing is dropped, which
 * is the safe direction to be wrong in.
 *
 * Returns '' when there is nothing usable, which the caller reads as
 * "no suggestion to offer".
 */
export function suggestedAddressLine1(completedAddress: string | null): string {
  if (completedAddress === null) return '';
  const whole = completedAddress.trim();
  if (whole === '') return '';
  const parts = whole.split(',');
  const last = parts[parts.length - 1] ?? '';
  const trimmed = /\d{6}\s*$/.test(last) && parts.length > 1 ? parts.slice(0, -1).join(',') : whole;
  // A trailing comma is theirs, not ours — "48, 2 Sarani," came in that
  // way from the operator and travels through their completion.
  return trimmed.replace(/[\s,]+$/, '').trim();
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
