/**
 * What a seller is told about each address field.
 *
 * Translated from the Bengali instructions the team already gives
 * sellers by hand, and mapped onto the fields this form actually has.
 * Two of the original rules did not transfer verbatim, and the mapping
 * is deliberate:
 *
 *  - The original template ends "State: ***". The form no longer has a
 *    State or City field at all: Delhivery routes on the PIN and
 *    resolves the locality itself, so asking a seller to type what the
 *    courier already knows is two chances to disagree instead of one
 *    fact. Line 1 asks for the parts the PIN cannot supply.
 *
 *  - The original says line 2 IS the landmark, and it now is: the seller
 *    form's separate Landmark field was removed. That is not only
 *    simplification. `destLandmark` is stored on the shipment but the
 *    Delhivery address is built from line 1 + line 2 alone, so anything
 *    typed into the old field never reached the driver. Putting the
 *    landmark on line 2 puts it on the parcel.
 *
 *    The COLUMN and the API field stay — CSV import still maps
 *    `landmark`, and orders placed before this still carry one.
 *
 * One place, read by the create form and the edit form, so the two
 * cannot start telling sellers different things.
 */

export const ADDRESS_LINE_1_HINT =
  'The address only, in this order — Village/City, Post Office, Police Station, District. No extra words; the PIN below decides the rest.';

export const ADDRESS_LINE_2_HINT =
  'The landmark only — a hospital, school or shop nearby. Nothing else, and never a copy of line 1: an order with both lines the same is held.';

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
