/**
 * What a seller is told about each address field.
 *
 * Translated from the Bengali instructions the team already gives
 * sellers by hand, and mapped onto the fields this form actually has.
 * Two of the original rules did not transfer verbatim, and the mapping
 * is deliberate:
 *
 *  - The original template ends "State: ***". State and PIN are their
 *    own fields here, so repeating them on line 1 would put the same
 *    fact in two places and leave the two free to disagree. Line 1 asks
 *    for the parts nothing else captures.
 *
 *  - The original says line 2 IS the landmark. This form has a separate
 *    Landmark field, so the landmark instruction goes THERE, where it
 *    applies, and line 2 keeps the rule that was actually about line 2:
 *    do not copy line 1 into it.
 *
 * One place, read by the create form and the edit form, so the two
 * cannot start telling sellers different things.
 */

export const ADDRESS_LINE_1_HINT =
  'The address only, in this order — Village/City, Post Office, Police Station, District. No extra words. State and PIN code have their own fields below.';

export const ADDRESS_LINE_2_HINT =
  'Only what did not fit on line 1. Do not copy line 1 here — an order with both lines the same is held.';

export const LANDMARK_HINT =
  'A nearby landmark only — a hospital, school or shop. Just the place, nothing else.';

/**
 * The duplicate-lines rule as a check rather than only as a sentence.
 * Advisory here (FE-2: the server decides); it exists so a seller is
 * told at the field instead of after the order is held.
 */
export function linesAreDuplicated(line1: string, line2: string): boolean {
  const a = line1.trim().toLowerCase().replace(/\s+/g, ' ');
  const b = line2.trim().toLowerCase().replace(/\s+/g, ' ');
  return a !== '' && a === b;
}

export const DUPLICATE_LINES_ERROR =
  'Address line 2 repeats line 1. Put the landmark or the rest of the address here, or leave it empty.';
