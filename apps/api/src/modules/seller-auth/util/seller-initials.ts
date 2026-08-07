/**
 * A seller's short code — "Menev Store" → "MSt".
 *
 * Three characters, derived from the company name, generated once at
 * signup and thereafter owned by staff. It is an OPERATIONS handle: the
 * thing you write on a tote, say on a call, or scan down a manifest
 * column. A UUID is unusable for that and the full company name is too
 * long to sit in a column.
 *
 * ── THE RULE ─────────────────────────────────────────────────────────
 * The shape follows from how many words the name has, so the result
 * always reads as initials rather than as a truncation:
 *
 *   3+ words   first letter of the first three     QA Test Traders → QTT
 *   2 words    first letter, then two of the next  Menev Store     → MSt
 *   1 word     first three letters                 Skydrop         → Sky
 *
 * Capitalisation follows the same logic: a letter that starts a source
 * word is capitalised, a letter carried from inside one is not. That is
 * what makes "MSt" read as M + St rather than as a chopped "MST".
 *
 * ── WHY IT IS UNIQUE ─────────────────────────────────────────────────
 * Anything short enough to write by hand will collide — two sellers
 * called "Menev Store" and "Modern Stationery" both want MSt. A code
 * that identifies two companies is worse than no code, because it fails
 * at exactly the moment it is being trusted: on a physical label. So the
 * column carries a unique constraint and generation takes a "taken"
 * predicate. Staff can override the result; the constraint still holds.
 */

/** Letters only. Accents are folded so "Café Noir" yields CNo, not CN. */
function words(companyName: string): string[] {
  return companyName
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .split(/[^A-Za-z]+/)
    .filter((w) => w.length > 0);
}

const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();

/**
 * The preferred code for a name, before any collision check.
 * Returns '' when the name has no letters at all — the caller decides
 * what to do rather than getting a silently wrong code.
 */
export function preferredInitials(companyName: string): string {
  const w = words(companyName);
  if (w.length === 0) return '';
  if (w.length >= 3) {
    return w
      .slice(0, 3)
      .map((x) => x.charAt(0).toUpperCase())
      .join('');
  }
  if (w.length === 2) {
    const first = w[0] ?? '';
    const second = w[1] ?? '';
    // Second word may be a single letter ("M S"), so take what exists.
    return (first.charAt(0).toUpperCase() + cap(second.slice(0, 2))).slice(0, 3);
  }
  return cap((w[0] ?? '').slice(0, 3));
}

/**
 * Candidates in preference order: the natural code first, then codes
 * built from later letters of the SAME name, and only then a numeric
 * tail. Trying the name's own letters before a digit keeps a collided
 * code still recognisable — "Menev Store" landing on MSo beats MS2.
 */
function* candidates(companyName: string): Generator<string> {
  const base = preferredInitials(companyName);
  if (base === '') return;
  yield base;

  const w = words(companyName);
  const head = base.slice(0, 2);

  // Walk the remaining letters of the last contributing word.
  const tail = (w.length >= 2 ? (w[1] ?? '') : (w[0] ?? '')).slice(2);
  for (const ch of tail) yield head + ch.toLowerCase();

  // Then first letters of any further words: "Ace Blue Cargo Ltd" → AbL.
  for (const extra of w.slice(2)) yield head + extra.charAt(0).toUpperCase();

  // Last resort. Two letters plus a digit still fits three characters and
  // is still pronounceable, which a hash would not be.
  for (let n = 2; n <= 99; n += 1) yield (head + String(n)).slice(0, 4);
}

/**
 * Resolve a unique code. `isTaken` is injected rather than queried here
 * so this stays a pure function with a real test — the alternative is a
 * generator that can only be exercised against a database.
 */
export async function generateSellerInitials(
  companyName: string,
  isTaken: (candidate: string) => Promise<boolean>,
): Promise<string> {
  for (const candidate of candidates(companyName)) {
    if (!(await isTaken(candidate))) return candidate;
  }
  // A name with no letters, or 100 collisions on the same two-letter head.
  // Neither should happen; failing loudly beats writing a duplicate.
  throw new Error(`Could not derive unique initials for "${companyName}"`);
}

/** Staff-supplied codes: 2-4 characters, letters and digits only. */
export const INITIALS_PATTERN = /^[A-Za-z0-9]{2,4}$/;
