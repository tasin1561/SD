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
 * What gets APPENDED to address line 1, in the order the field's own
 * hint asks for them — Post Office, Police Station, District.
 *
 * These are the parts the operator does not type and the service
 * resolves: the administrative tail that makes a line routable. The
 * house, street and locality are NOT here, because the operator has
 * already written those in their own words; `landmark` is line 2's
 * job; `state` and `pincode` belong to the PIN field, and a line 1
 * ending "West Bengal 700128" prints the PIN on the parcel twice.
 */
const APPEND_FIELDS: ReadonlyArray<{ key: string; prefix: string }> = [
  { key: 'post_office', prefix: 'PO ' },
  { key: 'police_station', prefix: 'PS ' },
  { key: 'district', prefix: '' },
];

/**
 * The words of a line, for comparison.
 *
 * `\p{L}\p{N}` and not `a-z0-9`: the ASCII version treated every Bangla
 * and Devanagari letter as a separator, so a line written in Bangla
 * tokenised to NOTHING. That was not merely a blind spot — an empty
 * token list makes `every()` vacuously true, so a post office returned
 * in Bangla read as "already present" and was silently dropped from the
 * suggestion. Half this product's operators type in Bangla.
 */
const tokens = (s: string): string[] =>
  s
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((t) => t !== '');

/**
 * The fields whose spelling may correct a word in line 1.
 *
 * ── WHAT IS MISSING, AND WHY IT MATTERS ──────────────────────────────
 * `state`, `pincode` and `landmark` are NOT here, and leaving them in
 * was a real bug. The dictionary was every extracted value, so a typed
 * "Bengali" — seven letters, one edit from the STATE "Bengal", same
 * first letter — was corrected to "Bengal", and a locality called
 * Bengali Para became Bengal Para on the parcel. `landmark` is excluded
 * for the same reason in the other direction: line 2 is the landmark
 * (ORD-5), so pulling line 1's words toward it corrects across a
 * boundary this file exists to keep.
 *
 * What remains is the set of things that can legitimately BE a word of
 * address line 1.
 */
const SPELLING_FIELDS = [
  'house',
  'street',
  'locality',
  'village_city',
  'post_office',
  'police_station',
  'sub_district',
  'district',
] as const;

/**
 * How far wrong a word may be and still count as the same word.
 *
 * Scaled by length because one wrong letter in a four-letter word is a
 * quarter of it and could easily be a different place, while two in a
 * ten-letter one is a typo. The short end is deliberately strict:
 * "Badu" and "Bagu" may well be two villages.
 */
function spellingTolerance(word: string): number {
  // Nothing under SEVEN letters is ever corrected. Raised from five
  // when the guarantee check caught what five allowed: "Mandir" sits
  // one edit from "Mandi", same first letter, and a landmark quietly
  // lost its last letter. At one edit a short word is as likely to
  // become a different word as a corrected one, and edit distance
  // cannot tell a typo from a truncation. Place names long enough to
  // be misspelt in practice — Madhyamgram, Barasat, Raydighi,
  // Parganas — all clear this bar.
  // RAISED AGAIN, to ten. Seven was still wrong, and a review proved it
  // with a second real pair: "Sonapur Road" became "Sonarpur Road",
  // because Sonapur and Sonarpur are both real places one letter apart
  // and seven letters is long enough to clear the old floor. That is
  // the Bengali/Bengal shape exactly — the restraint was about how
  // close a word is, and closeness is the one thing two different
  // nearby places always have.
  //
  // Below ten letters nothing is corrected at all. What survives is the
  // case the feature was asked for: a long name mistyped by one or two
  // letters, where no other real place is that close.
  if (word.length < 10) return 0;
  if (word.length < 13) return 1;
  return 2;
}

/** Levenshtein, bounded — it only ever runs on single address words. */
function editDistance(a: string, b: string): number {
  if (Math.abs(a.length - b.length) > 2) return 99;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    const row = [i];
    for (let j = 1; j <= b.length; j += 1) {
      row[j] = Math.min(
        (prev[j] ?? 99) + 1,
        (row[j - 1] ?? 99) + 1,
        (prev[j - 1] ?? 99) + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    prev = row;
  }
  return prev[b.length] ?? 99;
}

/**
 * Fix the spelling of words the operator already wrote.
 *
 * The ONLY in-place edit this file makes, and it is held to one rule:
 * a word may be respelt, never added, removed or reordered. "Madhamgram"
 * becomes "Madhyamgram"; nothing becomes something and something never
 * becomes nothing.
 *
 * ── WHY AMBIGUITY MEANS LEAVE IT ALONE ───────────────────────────────
 * A word is corrected only when exactly ONE known word is close enough.
 * Two candidates at the same distance is the case where picking is
 * guessing, and a confidently wrong village name is worse than a
 * misspelt one — the misspelt one still looks wrong to a human reading
 * the label, and the guess does not.
 *
 * Capitalisation follows what they returned, since that is the spelling
 * a label should carry.
 */
/** Every word the service returned for a field that can BE part of
 *  address line 1 — the only words a typed word may be corrected to,
 *  and the same set the guarantee checks against. */
function spellingDictionary(extracted: Readonly<Record<string, string | null>>): string[] {
  const known: string[] = [];
  for (const field of SPELLING_FIELDS) {
    for (const word of (extracted[field] ?? '').split(/[^A-Za-z]+/)) {
      if (word.length >= 4) known.push(word);
    }
  }
  return known;
}

function correctSpelling(line: string, known: readonly string[]): string {
  if (known.length === 0) return line;

  // Split keeping the separators, so punctuation and spacing survive
  // untouched — this rewrites words, not the line.
  return line
    .split(/([A-Za-z]+)/)
    .map((piece) => {
      // Only the length floor in `spellingTolerance` decides what is
      // too short — a second number here would be a second place to
      // change when that one moves, and it already drifted once when
      // the floor went from five to seven.
      if (!/^[A-Za-z]+$/.test(piece)) return piece;
      const lower = piece.toLowerCase();
      // Already a known word: nothing to fix.
      if (known.some((k) => k.toLowerCase() === lower)) return piece;
      const tolerance = spellingTolerance(piece);
      if (tolerance === 0) return piece;
      let best: string | null = null;
      let bestAt = tolerance + 1;
      let tied = false;
      for (const candidate of known) {
        // SAME FIRST LETTER, always. People misspell the middle of a
        // word and the end of it; they do not usually get the first
        // letter wrong. Without this, "Mandir" sits one edit from
        // "Mandi" and a landmark quietly loses its last letter — a
        // different word, not a correction.
        if (candidate[0]?.toLowerCase() !== lower[0]) continue;
        const d = editDistance(lower, candidate.toLowerCase());
        if (d > tolerance) continue;
        if (d < bestAt) {
          bestAt = d;
          best = candidate;
          tied = false;
        } else if (d === bestAt && candidate.toLowerCase() !== best?.toLowerCase()) {
          tied = true;
        }
      }
      return best === null || tied ? piece : best;
    })
    .join('');
}

/**
 * Is `result` nothing more than `typed` with words respelt and words
 * added to the end?
 *
 * THE GUARANTEE, checked rather than argued (owner, 2026-11-09): no
 * word of the operator's is replaced by a different word, removed, or
 * reordered. Everything above is written to honour that, and this is
 * what makes it true even if something above is wrong — a future edit
 * to the matching rules cannot quietly start rewriting addresses,
 * because the suggestion is dropped instead of offered.
 *
 * Positional, not set-based. A set test would accept a reordering, and
 * "12 North Road, Barasat" is not "Barasat Road, 12 North".
 */
export function appendOrRespellOnly(
  typed: string,
  result: string,
  known: readonly string[] = [],
): boolean {
  const before = tokens(typed);
  const after = tokens(result);
  // Shorter means something was dropped; the tail may only grow.
  if (after.length < before.length) return false;
  const dictionary = new Set(known.map((w) => w.toLowerCase()));
  return before.every((word, i) => {
    const got = after[i];
    if (got === undefined) return false;
    if (got === word) return true;
    /*
      Changed — allowed ONLY as a respelling.

      ── THE DICTIONARY TERM IS THE LOAD-BEARING ONE ──────────────────
      An earlier version checked only the distance, and a review proved
      it worthless: `appendOrRespellOnly("Bengali Para", "Bengal Para")`
      returned true, because "Bengal" IS one edit from "Bengali". A
      distance bound cannot tell a correction from a substitution — both
      are small edits — so on its own it guaranteed nothing, and the
      commit that introduced it said otherwise. That was overclaimed.

      What makes it a guarantee is that the new word must be one the
      SERVICE returned for a line 1 field. Then a changed word is not
      merely near something, it is the thing the service named.
    */
    if (!dictionary.has(got)) return false;
    const tolerance = spellingTolerance(word);
    if (tolerance === 0) return false;
    if (got[0] !== word[0]) return false;
    return editDistance(word, got) <= tolerance;
  });
}

/**
 * Address line 1 with the resolved parts added to the end of it.
 *
 * ── IT APPENDS. IT DOES NOT REPLACE. (owner, 2026-11-09) ─────────────
 * The first version of this composed a whole new line 1 out of their
 * `extracted` fields, and it never fired once on a real address —
 * because their extraction is not a superset of what the operator
 * typed. A real case: "Nadibhag, Badu Industrial Area" came back as
 * house 48 / street "2 sarani" / locality "Badu" / district "North 24
 * Parganas", with "Nadibhag" and "Industrial Area" nowhere in it. Any
 * replacement would have silently dropped two of the customer's words,
 * so the loss guard refused it, correctly — and the feature was dead
 * code dressed as a safety feature.
 *
 * Appending cannot lose a word, which makes the guard pass by
 * construction instead of by luck.
 *
 * ── WHY `inferred` IS WELCOME HERE ───────────────────────────────────
 * The earlier rule threw away every `inferred` field, and that threw
 * away the whole point: the post office and police station are exactly
 * what the operator did not type and the service worked out. The real
 * rule is narrower than "distrust inferred" — an inferred value must
 * never REPLACE something the operator wrote, but it may ADD a part
 * they never gave. Appending makes that distinction automatic, so the
 * source no longer has to be consulted at all.
 *
 * ── WHY NOT `completed_address` ──────────────────────────────────────
 * Because it always contains the landmark, and line 2 IS the landmark
 * here (ORD-5) — so applying their sentence put the landmark on the
 * parcel twice. Verified live on 2026-11-09: sending the landmark as
 * its own field does not keep it out of their completion either, so
 * there was no way to fix that by asking them differently.
 *
 * Returns '' when there is nothing to add, which the caller reads as
 * "no suggestion to offer".
 */
export function suggestedAddressLine1(
  currentLine1: string,
  extracted: Readonly<Record<string, string | null>> | null | undefined,
): string {
  if (extracted === null || extracted === undefined) return '';
  const typed = currentLine1.trim().replace(/[\s,]+$/, '');
  const known = spellingDictionary(extracted);
  let line = correctSpelling(typed, known);
  let added = line !== typed;
  for (const { key, prefix } of APPEND_FIELDS) {
    const value = (extracted[key] ?? '').trim();
    if (value === '') continue;
    // Compared against the line AS IT IS BEING BUILT, so a district
    // already named inside the post office — "PO Badu (North 24
    // Parganas)" — is not then repeated on its own. When the post
    // office carries no such parenthetical the district still gets
    // appended, which is the behaviour that adapts rather than a rule
    // that has to be maintained per format.
    const have = new Set(tokens(line));
    const valueWords = tokens(value);
    // `every()` on an empty list is TRUE, which read as "already
    // present" and dropped the part. A value with no tokens we can
    // compare is a value we must not claim to have.
    if (valueWords.length > 0 && valueWords.every((t) => have.has(t))) continue;
    line = line === '' ? `${prefix}${value}` : `${line}, ${prefix}${value}`;
    added = true;
  }
  if (!added) return '';
  // The last word before it leaves this function. If the result is
  // anything but the operator's line respelt and extended, it is not
  // offered at all — an address nobody suggested beats an address
  // somebody rewrote.
  return appendOrRespellOnly(typed, line, known) ? line : '';
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
  const have = tokens(suggested);
  const exact = new Set(have);
  return tokens(currentLine1).every((t) => {
    if (exact.has(t)) return true;
    /*
      A RESPELT word is still the word.

      Without this the guard blocked every spelling correction — the
      misspelling is gone by design, so an exact-membership test read
      it as a dropped word and refused the whole suggestion. A word
      that was genuinely dropped has no near neighbour, so the guard
      still catches exactly what it was written for.
    */
    const tolerance = spellingTolerance(t);
    return tolerance > 0 && have.some((h) => editDistance(t, h) <= tolerance);
  });
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
