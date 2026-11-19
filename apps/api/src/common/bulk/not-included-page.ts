import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

export interface NotIncluded {
  /** What the person knows the order by. */
  readonly label: string;
  /** Why it is not in the file, in the server's words. */
  readonly reason: string;
}

const MARGIN = 48;
const LINE = 16;
const PAGE_W = 595;
const PAGE_H = 842;

/** Anything a standard PDF font cannot draw becomes `?` rather than failing the file. */
function safe(text: string): string {
  return text.replace(/[^\x20-\x7e]/g, '?');
}

/**
 * Append "Not included" page(s) to a merged PDF, one line per order left out.
 *
 * A short stack is indistinguishable from a complete one once it is printed,
 * so the orders that are missing are NAMED in the file itself, not only in a
 * response header nobody reads. Paginates, so 200 skips never run off a page.
 */
export async function appendNotIncludedPages(
  out: PDFDocument,
  items: readonly NotIncluded[],
): Promise<void> {
  if (items.length === 0) return;
  const font = await out.embedFont(StandardFonts.Helvetica);
  const bold = await out.embedFont(StandardFonts.HelveticaBold);
  const perPage = Math.floor((PAGE_H - MARGIN * 2 - 40) / LINE);
  for (let start = 0; start < items.length; start += perPage) {
    const page = out.addPage([PAGE_W, PAGE_H]);
    let y = PAGE_H - MARGIN;
    page.drawText(start === 0 ? 'Not included' : 'Not included (continued)', {
      x: MARGIN,
      y,
      size: 16,
      font: bold,
      color: rgb(0, 0, 0),
    });
    y -= 32;
    for (const it of items.slice(start, start + perPage)) {
      page.drawText(safe(`${it.label} - ${it.reason}`).slice(0, 110), {
        x: MARGIN,
        y,
        size: 10,
        font,
        color: rgb(0.1, 0.1, 0.1),
      });
      y -= LINE;
    }
  }
}
