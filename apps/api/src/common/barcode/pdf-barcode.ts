import type PDFDocument from 'pdfkit';
import { encodeCode128B, isEncodableCode128B } from './code128';

/**
 * Draw a Code 128 symbol into a PDF, from the ONE encoder (LBL-3).
 *
 * Extracted when the picking sheet needed bars too — a second copy of
 * this loop is how two sheets come to disagree about the quiet zone, and
 * a symbol whose first character will not read is indistinguishable from
 * a scanner fault at the bench.
 *
 * Returns false and draws NOTHING when the value cannot be encoded, so
 * the caller can fall back to printing the text alone. A partial barcode
 * is worse than none: it scans, and it scans as something else.
 */
export function drawCode128(
  doc: InstanceType<typeof PDFDocument>,
  opts: {
    readonly value: string;
    readonly x: number;
    readonly y: number;
    /** Total box width INCLUDING both quiet zones. */
    readonly width: number;
    readonly height: number;
  },
): boolean {
  if (!isEncodableCode128B(opts.value)) return false;

  let widths: number[];
  try {
    widths = encodeCode128B(opts.value);
  } catch {
    return false;
  }

  const modules = widths.reduce((n, m) => n + m, 0);
  // Ten modules of quiet zone each side is what the spec asks for, and
  // it is the part people leave out and then wonder why the scanner will
  // not read the first character.
  const unit = opts.width / (modules + QUIET_MODULES * 2);

  let cursor = opts.x + unit * QUIET_MODULES;
  let bar = true;
  doc.save().fillColor('#000000');
  for (const width of widths) {
    const barWidth = width * unit;
    if (bar) doc.rect(cursor, opts.y, barWidth, opts.height).fill();
    cursor += barWidth;
    bar = !bar;
  }
  doc.restore();
  return true;
}

const QUIET_MODULES = 10;

/**
 * The narrowest bar this value would print at, in POINTS.
 *
 * Worth asking before choosing a column width. Below about 0.55pt
 * (0.19mm) a laser-printed Code 128 stops being reliably readable by
 * warehouse scanners — and it fails by being slow and intermittent
 * rather than by not scanning at all, which is the more expensive way to
 * find out.
 */
export function code128ModuleWidth(value: string, boxWidth: number): number | null {
  if (!isEncodableCode128B(value)) return null;
  try {
    const modules = encodeCode128B(value).reduce((n, m) => n + m, 0);
    return boxWidth / (modules + QUIET_MODULES * 2);
  } catch {
    return null;
  }
}
