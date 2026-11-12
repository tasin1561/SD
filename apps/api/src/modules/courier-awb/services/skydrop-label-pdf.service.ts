import { Injectable } from '@nestjs/common';
import PDFDocument from 'pdfkit';
import { drawCode128 } from '../../../common/barcode/pdf-barcode';
import { courierMark } from './courier-marks';

/**
 * Module 9 — the shipping label we render OURSELVES.
 *
 * ── WHY THIS EXISTS (owner, 2026-11-12) ──────────────────────────────
 * Delhivery's `packing_slip` renders a label from OUR account, so its
 * masthead always reads "Skydrop" — the account name is fixed per client
 * and there is no manifest field for a per-parcel logo. Our sellers ship
 * into India under their OWN brand, and the parcel the customer opens is
 * the only thing they see. So the masthead has to carry the SELLER's
 * business name ("Menev Store"), which means we draw the label.
 *
 * ── THE SWITCH IS THE POINT ──────────────────────────────────────────
 * A courier's hub sorts from the label it expects. If this one is missing
 * something theirs carried, parcels are refused at pickup and we find out
 * with a van at the door. `courier.use_own_label_pdf` decides which label
 * a parcel gets, per generation, so going back is a settings change and
 * not a deploy. Delhivery's own path is untouched and still works.
 *
 * ── WHAT THE HUB READS, AND WHY IT IS COPIED EXACTLY ─────────────────
 * Two things on this sheet are not decoration:
 *   - the AWB barcode, which every scan from pickup to delivery keys on;
 *   - the SORT CODE (`KLT/MDH`), which tells the hub which bag the parcel
 *     goes in. It comes from Delhivery at booking (`shipments
 *     .courier_sort_code`). A label without it is a parcel their hub
 *     cannot route, so `renderShippingLabel` prints a loud placeholder
 *     rather than a blank when it is missing — a missing sort code must
 *     look wrong to the person holding the sheet, not merely be absent.
 *
 * LBL-3: the ONE Code 128 encoder draws both symbols. Never add a second
 * encoder or a barcode library — a disagreeing implementation prints a
 * symbol that scans as something other than the text beside it, and the
 * label stays self-consistent all the way to the wrong customer.
 */

/** 4R — 4in x 6in at 72pt/in, which is the stock the benches load. */
const PAGE_WIDTH = 288;
const PAGE_HEIGHT = 432;
const MARGIN = 10;
const CONTENT_W = PAGE_WIDTH - MARGIN * 2;

export interface ShippingLabelItem {
  readonly productName: string;
  readonly skuCode: string;
  readonly quantity: number;
  /** Already formatted, e.g. "1,050.00" — money is never computed here. */
  readonly lineTotalInr: string;
}

export interface ShippingLabelData {
  /** The masthead. The SELLER's business name, never Skydrop's. */
  readonly sellerName: string;
  readonly awbNumber: string;
  readonly courierName: string;
  /**
   * The name the COURIER knows us by — "MS EXPORTS" — printed on every
   * label beside the client's (owner, 2026-11-12).
   *
   * The masthead carries the client because that is who the customer
   * bought from; this carries the account the parcel is booked under,
   * because that is who Delhivery's people recognise when they handle
   * it. Both, always: one is for the person opening the box and the
   * other is for the person carrying it.
   */
  readonly accountName: string | null;
  /** Delhivery's routing code. Null is rendered as a visible warning. */
  readonly sortCode: string | null;
  readonly destinationPin: string;
  readonly recipientName: string;
  readonly recipientPhone: string | null;
  readonly recipientAddress: string;
  readonly isCod: boolean;
  /** What the rider collects on COD; the declared value otherwise. */
  readonly amountInr: string;
  readonly items: readonly ShippingLabelItem[];
  readonly totalInr: string;
  /** The SELLER's own reference — the second barcode (never ours). */
  readonly orderReference: string;
  readonly generatedAt: Date;
}

@Injectable()
export class SkydropLabelPdfService {
  async render(data: ShippingLabelData): Promise<Buffer> {
    return renderShippingLabel(data);
  }
}

/**
 * Pure: data in, PDF bytes out. No database, no clock, no settings — so a
 * test can assert the sheet for a 12-line parcel with a missing sort code
 * without standing up any of that.
 */
export function renderShippingLabel(data: ShippingLabelData): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
    const doc = new PDFDocument({
      size: [PAGE_WIDTH, PAGE_HEIGHT],
      margin: 0,
      info: { Title: `Shipping label ${data.awbNumber}` },
    });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    try {
      draw(doc, data);
      doc.end();
    } catch (e) {
      reject(e instanceof Error ? e : new Error(String(e)));
    }
  });
}

function draw(doc: InstanceType<typeof PDFDocument>, d: ShippingLabelData): void {
  const left = MARGIN;
  let y = MARGIN;

  doc.lineWidth(0.7).strokeColor('#000000');
  doc.rect(left, y, CONTENT_W, PAGE_HEIGHT - MARGIN * 2).stroke();

  // ── 1. Masthead: BOTH names, same size, on one line (owner,
  // 2026-11-12 — "equal importance"). The client is who the customer
  // bought from; the account is who Delhivery recognises when their
  // hand picks the box up. Neither is a subtitle of the other, so
  // neither gets smaller type.
  const headerH = 34;
  const account = (d.accountName ?? '').trim();
  // ACCOUNT FIRST, then the client (owner, 2026-11-12). Delhivery's own
  // people read the account name, and they read left to right.
  const names = account === '' ? upper(d.sellerName) : `${upper(account)} / ${upper(d.sellerName)}`;
  // The mark of whoever is carrying it, drawn from the carrier's own
  // artwork; a courier we hold no mark for falls back to its name.
  const mark = courierMark(d.courierName);
  const markW = 74;
  const namesW = CONTENT_W - 16 - (mark === null ? 52 : markW + 10);
  // Smaller than the carrier's mark (owner, 2026-11-12): the mark is
  // what a hub hand looks for first, and two business names set larger
  // than it fought with it for the top of the sheet.
  //
  // Shrink to fit rather than truncate: two business names ellipsised
  // in the middle ("MENEV ST… / MS EXP…") serve nobody, and this line
  // is the one thing on the sheet both parties look for.
  let nameSize = 9;
  doc.font('Helvetica-Bold');
  while (nameSize > 7 && doc.fontSize(nameSize).widthOfString(names) > namesW) nameSize -= 0.5;
  doc
    .fontSize(nameSize)
    .fillColor('#000000')
    .text(names, left + 8, y + (headerH - nameSize) / 2 - 1, {
      width: namesW,
      height: nameSize + 4,
      ellipsis: true,
      lineBreak: false,
    });

  if (mark === null) {
    doc
      .fontSize(7)
      .font('Helvetica')
      .fillColor('#555555')
      .text(upper(d.courierName), left + CONTENT_W - 58, y + 14, {
        width: 52,
        align: 'right',
        height: 9,
        ellipsis: true,
        lineBreak: false,
      })
      .fillColor('#000000');
  } else {
    try {
      doc.image(mark, left + CONTENT_W - markW - 7, y + 9, { width: markW });
    } catch {
      // A mark that will not decode must not cost the whole label.
      doc
        .fontSize(7)
        .font('Helvetica')
        .fillColor('#555555')
        .text(upper(d.courierName), left + CONTENT_W - 58, y + 14, {
          width: 52,
          align: 'right',
          lineBreak: false,
        })
        .fillColor('#000000');
    }
  }
  y += headerH;
  rule(doc, left, y);

  // ── 2. The AWB: as text above, as bars in the middle, and repeated in
  // the strip below between the destination PIN and the SORT CODE. That
  // strip is the band a hub reads when it is bagging, and the reference
  // sheet repeats the number inside it deliberately — a torn label with
  // only the strip left is still routable.
  doc
    .fontSize(10)
    .font('Helvetica')
    .fillColor('#000000')
    .text(`AWB# ${d.awbNumber}`, left + 6, y + 5, { width: CONTENT_W - 12, lineBreak: false });
  y += 18;

  const barH = 40;
  const barcodeW = CONTENT_W - 60;
  const drew = drawCode128(doc, {
    value: d.awbNumber,
    x: left + 30,
    y: y + 2,
    width: barcodeW,
    height: barH - 4,
  });
  if (!drew) {
    doc
      .fontSize(12)
      .font('Helvetica-Bold')
      .text(d.awbNumber, left + 6, y + 14, { width: CONTENT_W - 12, align: 'center' });
  }
  y += barH;

  // The routing strip: PIN · AWB · SORT CODE.
  const stripH = 14;
  doc.fontSize(8).font('Helvetica').fillColor('#000000');
  doc.text(d.destinationPin, left + 6, y + 3, { width: 60, lineBreak: false });
  doc.font('Helvetica-Bold').text(`AWB# ${d.awbNumber}`, left + 60, y + 3, {
    width: CONTENT_W - 130,
    align: 'center',
    lineBreak: false,
  });
  // A missing sort code is a parcel the hub cannot route. It is printed
  // as a visible defect rather than left blank, because a blank reads as
  // "this label has no sort code" and a warning reads as "ask someone".
  const sort = (d.sortCode ?? '').trim();
  const missing = sort === '';
  doc
    .fontSize(missing ? 7 : 8)
    .fillColor(missing ? '#B00000' : '#000000')
    .text(missing ? 'NO SORT CODE' : sort, left + CONTENT_W - 76, y + 3, {
      width: 70,
      align: 'right',
      height: 10,
      ellipsis: true,
      lineBreak: false,
    });
  doc.fillColor('#000000');
  y += stripH;
  rule(doc, left, y);

  // ── 3. Ship to, and the amount being collected.
  const shipH = 92;
  const addrW = CONTENT_W - 84;
  doc
    .fontSize(7.5)
    .font('Helvetica-Bold')
    .text('SHIP TO', left + 6, y + 5);
  doc
    .fontSize(9.5)
    .font('Helvetica-Bold')
    .text(d.recipientName, left + 6, y + 15, { width: addrW, height: 12, ellipsis: true });
  let ay = y + 27;
  if (d.recipientPhone !== null && d.recipientPhone !== '') {
    doc
      .fontSize(8)
      .font('Helvetica')
      .text(d.recipientPhone, left + 6, ay, { width: addrW });
    ay += 10;
  }
  doc
    .fontSize(7.5)
    .font('Helvetica')
    .text(d.recipientAddress, left + 6, ay, { width: addrW, height: shipH - (ay - y) - 14 });
  doc
    .fontSize(8.5)
    .font('Helvetica-Bold')
    .text(`PIN: ${d.destinationPin}`, left + 6, y + shipH - 12, { width: addrW, lineBreak: false });

  // Right column: what to collect, then when the label was made —
  // the two things the rider and the bench respectively look for.
  doc
    .moveTo(left + CONTENT_W - 94, y)
    .lineTo(left + CONTENT_W - 94, y + shipH)
    .stroke();
  const colX = left + CONTENT_W - 88;
  doc
    .fontSize(8.5)
    .font('Helvetica-Bold')
    .text(d.isCod ? 'COD' : 'PREPAID', colX, y + 8, { width: 82, lineBreak: false });
  doc
    .fontSize(d.amountInr.length > 9 ? 10 : 12.5)
    .font('Helvetica-Bold')
    .text(`INR ${d.amountInr}`, colX, y + 20, {
      width: 82,
      height: 16,
      ellipsis: true,
      lineBreak: false,
    });
  if (!d.isCod) {
    doc
      .fontSize(6.5)
      .font('Helvetica')
      .fillColor('#B00000')
      .text('DO NOT COLLECT', colX, y + 36, { width: 82, lineBreak: false })
      .fillColor('#000000');
  }
  doc
    .moveTo(left + CONTENT_W - 94, y + 48)
    .lineTo(left + CONTENT_W, y + 48)
    .stroke();
  doc
    .fontSize(7)
    .font('Helvetica-Bold')
    .text('Date', colX, y + 53, { width: 82, lineBreak: false });
  doc
    .fontSize(6.5)
    .font('Helvetica')
    .fillColor('#444444')
    .text(formatStamp(d.generatedAt), colX, y + 63, { width: 82, lineBreak: false })
    .fillColor('#000000');
  y += shipH;
  rule(doc, left, y);

  // ── 3b. The recipient again, over the SELLER's own reference as bars.
  // The name is what a human matches against the parcel in their hand;
  // the symbol is the seller's reference, because ours means nothing to
  // the person who has to answer "where is my order".
  const refBandH = 46;
  doc
    .fontSize(9)
    .font('Helvetica-Bold')
    .text(d.recipientName, left + 6, y + 4, {
      width: CONTENT_W - 12,
      height: 11,
      ellipsis: true,
      lineBreak: false,
    });
  const refDrew = drawCode128(doc, {
    value: d.orderReference,
    x: left + 6,
    y: y + 16,
    width: CONTENT_W - 110,
    height: 20,
  });
  doc
    .fontSize(7)
    .font(refDrew ? 'Helvetica' : 'Helvetica-Bold')
    .text(d.orderReference, left + 6, y + (refDrew ? 37 : 24), {
      width: CONTENT_W - 110,
      align: 'center',
      height: 9,
      ellipsis: true,
      lineBreak: false,
    });
  y += refBandH;
  rule(doc, left, y);

  // ── 5. Contents. Qty and Total are right-aligned so a packer comparing
  // the sheet to the box reads one column, not a ragged edge.
  const headH = 13;
  const qtyX = left + CONTENT_W - 86;
  const totX = left + CONTENT_W - 56;
  doc.fontSize(7).font('Helvetica-Bold').fillColor('#000000');
  doc.text('PRODUCT NAME & SKU', left + 6, y + 4, { width: qtyX - left - 10, lineBreak: false });
  doc.text('QTY', qtyX, y + 4, { width: 26, align: 'right', lineBreak: false });
  doc.text('TOTAL', totX, y + 4, { width: 50, align: 'right', lineBreak: false });
  y += headH;
  rule(doc, left, y);

  // The table gets whatever is left above the footer; a parcel with more
  // lines than fit says so rather than overprinting the barcode below.
  const footerH = 56;
  const tableBottom = PAGE_HEIGHT - MARGIN - footerH;
  let shown = 0;
  for (const it of d.items) {
    const rowH = 18;
    if (y + rowH > tableBottom) break;
    doc
      .fontSize(7.5)
      .font('Helvetica')
      .fillColor('#000000')
      .text(it.productName, left + 6, y + 3, {
        width: qtyX - left - 10,
        height: 9,
        ellipsis: true,
        lineBreak: false,
      });
    doc
      .fontSize(6.5)
      .fillColor('#555555')
      .text(`SKU: ${it.skuCode}`, left + 6, y + 11, {
        width: qtyX - left - 10,
        height: 8,
        ellipsis: true,
        lineBreak: false,
      });
    doc
      .fontSize(8)
      .fillColor('#000000')
      .text(String(it.quantity), qtyX, y + 6, { width: 26, align: 'right', lineBreak: false });
    doc.text(it.lineTotalInr, totX, y + 6, { width: 50, align: 'right', lineBreak: false });
    y += rowH;
    shown++;
  }
  const hidden = d.items.length - shown;
  if (hidden > 0) {
    doc
      .fontSize(7)
      .font('Helvetica-Bold')
      .fillColor('#B00000')
      .text(
        `+ ${hidden} more line${hidden === 1 ? '' : 's'} — see the picking sheet`,
        left + 6,
        y + 3,
        {
          width: CONTENT_W - 12,
          lineBreak: false,
        },
      )
      .fillColor('#000000');
    y += 12;
  }

  rule(doc, left, tableBottom);
  doc
    .fontSize(8)
    .font('Helvetica-Bold')
    .text('TOTAL', left + 6, tableBottom + 4, { width: 60, lineBreak: false });
  doc.text(d.totalInr, totX, tableBottom + 4, { width: 50, align: 'right', lineBreak: false });

  // NO RETURN ADDRESS BLOCK — the owner's call (2026-11-12). An
  // undeliverable parcel comes back on the AWB, which the courier routes
  // from their own system, so the printed address was never what made an
  // RTO work; and the sheet is the seller's brand in a customer's hands.
  // Do not add one back without asking: it is a deliberate absence, not
  // an oversight, and it is the kind of thing that looks like a bug to
  // whoever reads this next.
}

function rule(doc: InstanceType<typeof PDFDocument>, left: number, y: number): void {
  doc
    .moveTo(left, y)
    .lineTo(left + CONTENT_W, y)
    .stroke();
}

function upper(s: string): string {
  return s.trim().toUpperCase();
}

/**
 * `12-Nov-2026 | 6:55 PM` — the reference sheet's own stamp format, in
 * IST, which is where the parcel is and where anybody reading the label
 * is standing. Never the server's local zone.
 */
export function formatStamp(at: Date): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kolkata',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).formatToParts(at);
  const get = (t: string): string => parts.find((p) => p.type === t)?.value ?? '';
  const hour = get('hour');
  const period = get('dayPeriod').toUpperCase();
  return `${get('day')}-${get('month')}-${get('year')} | ${hour}:${get('minute')} ${period}`;
}
