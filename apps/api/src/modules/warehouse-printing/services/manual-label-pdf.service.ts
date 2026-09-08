import { Injectable } from '@nestjs/common';
import PDFDocument from 'pdfkit';

import { drawCode128 } from '../../../common/barcode/pdf-barcode';

export interface ManualLabelPayload {
  readonly awbNumber: string;
  readonly courierName: string;
  readonly orderNumber: string;
  readonly sellerCompanyName: string;
  readonly recipientName: string;
  readonly recipientPhone: string;
  readonly addressLine1: string;
  readonly addressLine2: string;
  readonly city: string;
  readonly stateProvince: string;
  readonly postalCode: string;
  readonly isCod: boolean;
  readonly codAmountInr: string | null;
  readonly weightGrams: number | null;
  readonly items: ReadonlyArray<{ name: string; skuCode: string; quantity: number }>;
}

/**
 * The label for a parcel no integrated courier is carrying.
 *
 * Delhivery and Shiprocket each hand us a finished PDF. A manual courier
 * has no API and no label — the waybill is a number an operator read off
 * a paper docket — so the parcel would otherwise go out with nothing on
 * it saying where it is meant to end up.
 *
 * Deliberately courier-NEUTRAL: it carries our AWB, the destination and
 * the contents, and names whoever is carrying it in one line. It is not
 * an imitation of anybody's label — a sticker pretending to be Delhivery
 * on a parcel Delhivery refused is worse than no sticker at all.
 *
 * ONE LABEL PER 4x6 PAGE (2026-09-09), not four to an A4 sheet.
 *
 * The earlier note said A4 was "the paper a warehouse office actually
 * has" and that cutting four apart beat feeding a roll printer nobody
 * had bought. That was a guess about the building, and the building has
 * a 4x6 label printer — so the courier labels and ours are now the same
 * size, and nobody cuts anything. It also removes a real hazard: four
 * labels on one sheet means one mis-cut puts a waybill on the wrong
 * parcel, and a shipping label is exactly the thing that must not be
 * approximately right.
 *
 * The picking list stays A4. It is a document somebody reads while
 * walking, not a sticker.
 */
@Injectable()
export class ManualLabelPdfService {
  /** 4in x 6in at 72pt/in — the standard thermal label. */
  private static readonly PAGE: [number, number] = [288, 432];
  private static readonly MARGIN = 12;

  async render(labels: readonly ManualLabelPayload[]): Promise<Buffer> {
    return new Promise<Buffer>((resolve, reject) => {
      const doc = new PDFDocument({
        size: ManualLabelPdfService.PAGE,
        margin: ManualLabelPdfService.MARGIN,
        info: { Title: 'Shipping labels', Author: 'Skydrop' },
      });
      const chunks: Buffer[] = [];
      doc.on('data', (c: Buffer) => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);
      try {
        this.drawSheet(doc, labels);
        doc.end();
      } catch (e) {
        reject(e instanceof Error ? e : new Error(String(e)));
      }
    });
  }

  private drawSheet(
    doc: InstanceType<typeof PDFDocument>,
    labels: readonly ManualLabelPayload[],
  ): void {
    const m = ManualLabelPdfService.MARGIN;
    // One per page: the label IS the page now, so there is no grid and
    // no cut line to get wrong.
    labels.forEach((label, i) => {
      if (i > 0) doc.addPage();
      this.drawLabel(doc, label, m, m, doc.page.width - m * 2, doc.page.height - m * 2);
    });
  }

  /**
   * Draw the waybill as a Code 128 barcode, returning the y to carry on
   * from.
   *
   * Sized to FIT rather than to a fixed module width: a long
   * alphanumeric docket number and a short numeric one both have to
   * live in the same cell, and a barcode overflowing its box is one a
   * scanner reads as a different, shorter number.
   *
   * If the value cannot be encoded we draw NOTHING and let the digits
   * stand alone. A partial barcode is worse than none — it scans, and
   * it scans wrongly.
   */
  private drawBarcode(
    doc: InstanceType<typeof PDFDocument>,
    value: string,
    x: number,
    y: number,
    maxWidth: number,
  ): number {
    const height = 26;
    // The drawing itself moved to common/barcode/pdf-barcode.ts when the
    // picking sheet needed bars too (LBL-3: one encoder, and now one
    // renderer). It returns false rather than drawing a partial symbol.
    return drawCode128(doc, { value, x, y, width: maxWidth, height }) ? y + height + 3 : y;
  }

  private drawLabel(
    doc: InstanceType<typeof PDFDocument>,
    l: ManualLabelPayload,
    x: number,
    y: number,
    w: number,
    h: number,
  ): void {
    doc.save();
    doc.roundedRect(x, y, w, h, 4).lineWidth(1).strokeColor('#000000').stroke();

    const pad = 10;
    let cy = y + pad;

    // Who is carrying it, said plainly. A driver holding a parcel with
    // an unfamiliar number needs to know whose network it is on.
    doc.fontSize(7).font('Helvetica').fillColor('#000000');
    doc.text('CARRIED BY', x + pad, cy, { width: w - pad * 2 });
    cy += 9;
    doc
      .fontSize(13)
      .font('Helvetica-Bold')
      .text(l.courierName.toUpperCase(), x + pad, cy, {
        width: w - pad * 2,
        ellipsis: true,
      });
    cy += 18;

    // The waybill — SCANNED far more often than it is read. Our own
    // pack bench and handover bench both read it off this label, and a
    // number somebody has to type is a number somebody mistypes.
    doc
      .fontSize(7)
      .font('Helvetica')
      .text('AWB', x + pad, cy);
    cy += 9;
    cy = this.drawBarcode(doc, l.awbNumber, x + pad, cy, w - pad * 2);

    // The digits stay UNDER the bars — the convention, and the
    // fallback: a smudged or badly-printed barcode still leaves a human
    // able to read the parcel's number.
    doc
      .fontSize(13)
      .font('Helvetica-Bold')
      .text(l.awbNumber, x + pad, cy, {
        width: w - pad * 2,
        ellipsis: true,
        characterSpacing: 1,
      });
    cy += 18;

    doc
      .moveTo(x + pad, cy)
      .lineTo(x + w - pad, cy)
      .lineWidth(0.5)
      .stroke();
    cy += 8;

    doc
      .fontSize(7)
      .font('Helvetica')
      .text('DELIVER TO', x + pad, cy);
    cy += 9;
    doc
      .fontSize(11)
      .font('Helvetica-Bold')
      .text(l.recipientName, x + pad, cy, {
        width: w - pad * 2,
        ellipsis: true,
      });
    cy += 14;

    // City and state are optional on an order (ORD-5), so they are
    // filtered rather than printed as empty lines — a label with a
    // dangling comma reads as broken data to whoever is holding it.
    const addressLines = [
      l.addressLine1,
      l.addressLine2,
      [l.city, l.stateProvince].filter((v) => v.trim() !== '').join(', '),
    ].filter((v) => v.trim() !== '');

    doc.fontSize(9).font('Helvetica');
    for (const line of addressLines) {
      doc.text(line, x + pad, cy, { width: w - pad * 2, ellipsis: true });
      cy += 11;
    }
    doc
      .fontSize(11)
      .font('Helvetica-Bold')
      .text(`PIN ${l.postalCode}`, x + pad, cy);
    cy += 14;
    doc
      .fontSize(9)
      .font('Helvetica')
      .text(`Phone: ${l.recipientPhone}`, x + pad, cy);
    cy += 13;

    // COD is the loudest thing on the label after the waybill: a driver
    // who hands over a parcel without collecting has lost the money.
    if (l.isCod && l.codAmountInr !== null) {
      doc.rect(x + pad, cy, w - pad * 2, 20).fillAndStroke('#000000', '#000000');
      doc
        .fillColor('#ffffff')
        .fontSize(12)
        .font('Helvetica-Bold')
        .text(`COLLECT  INR ${l.codAmountInr}`, x + pad + 6, cy + 5, { width: w - pad * 2 - 12 });
      doc.fillColor('#000000');
      cy += 26;
    } else {
      doc
        .fontSize(9)
        .font('Helvetica-Bold')
        .text('PREPAID — collect nothing', x + pad, cy);
      cy += 14;
    }

    // Footer: what is inside and who sent it, small.
    const remaining = y + h - cy - pad;
    if (remaining > 20) {
      doc
        .moveTo(x + pad, cy)
        .lineTo(x + w - pad, cy)
        .lineWidth(0.5)
        .stroke();
      cy += 6;
      doc.fontSize(7).font('Helvetica').fillColor('#333333');
      doc.text(`${l.orderNumber}  ·  ${l.sellerCompanyName}`, x + pad, cy, {
        width: w - pad * 2,
        ellipsis: true,
      });
      cy += 9;
      const contents = l.items
        .map((it) => `${it.quantity}x ${it.skuCode}`)
        .join(', ')
        .slice(0, 120);
      if (contents !== '' && y + h - cy - pad > 10) {
        doc.text(contents, x + pad, cy, { width: w - pad * 2, height: 18, ellipsis: true });
      }
    }

    doc.restore();
  }
}
