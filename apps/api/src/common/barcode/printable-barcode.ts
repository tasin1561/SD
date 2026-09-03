import { encodeCode128B, isEncodableCode128B } from './code128';

export interface PrintableBarcode {
  /** The exact string the symbol encodes — printed under it too, so a
   *  smudged label is still readable by a person. */
  readonly value: string;
  /**
   * Alternating bar/space widths in modules, starting with a bar, or
   * NULL when the value cannot be carried by Code 128 subset B.
   *
   * Null rather than a throw: one SKU with an unprintable character
   * must not fail the whole sheet — the other forty labels are fine and
   * the warehouse needs them. The caller renders the text alone for
   * that one, which is exactly where it was before barcodes existed.
   */
  readonly widths: readonly number[] | null;
}

/**
 * Prepare a value for printing as a Code 128 symbol.
 *
 * ENCODING HAPPENS HERE, ON THE SERVER, ONCE. The client is handed
 * widths and only draws rectangles. A second encoder on the client
 * would not fail loudly if it disagreed: it would print a barcode that
 * scans as a DIFFERENT value than the text beside it, and the label
 * would agree with itself all the way to the wrong customer.
 */
export function printableBarcode(value: string): PrintableBarcode {
  if (!isEncodableCode128B(value)) return { value, widths: null };
  return { value, widths: encodeCode128B(value) };
}
