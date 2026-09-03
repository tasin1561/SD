import { Injectable } from '@nestjs/common';
import PDFDocument from 'pdfkit';

import { encodeCode128B, isEncodableCode128B } from '../../../common/barcode/code128';

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
 * A4 with four labels to a sheet, because that is the paper a warehouse
 * office actually has and cutting four apart is faster than feeding a
 * roll printer nobody bought.
 */
@Injectable()
export class ManualLabelPdfService {
  /** Four to an A4 sheet: 2 columns x 2 rows. */
  private static readonly COLS = 2;
  private static readonly ROWS = 2;
  private static readonly MARGIN = 24;

  async render(labels: readonly ManualLabelPayload[]): Promise<Buffer> {
    return new Promise<Buffer>((resolve, reject) => {
      const doc = new PDFDocument({
        size: 'A4',
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
    const perPage = ManualLabelPdfService.COLS * ManualLabelPdfService.ROWS;
    const cellW = (doc.page.width - m * 2) / ManualLabelPdfService.COLS;
    const cellH = (doc.page.height - m * 2) / ManualLabelPdfService.ROWS;

    labels.forEach((label, i) => {
      if (i > 0 && i % perPage === 0) doc.addPage();
      const slot = i % perPage;
      const x = m + (slot % ManualLabelPdfService.COLS) * cellW;
      const y = m + Math.floor(slot / ManualLabelPdfService.COLS) * cellH;
      this.drawLabel(doc, label, x, y, cellW - 10, cellH - 10);
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
    if (!isEncodableCode128B(value)) return y;

    let widths: number[];
    try {
      widths = encodeCode128B(value);
    } catch {
      return y;
    }

    const modules = widths.reduce((n, m) => n + m, 0);
    // A quiet zone of 10 modules each side is what the spec asks for,
    // and it is the part people leave out and then wonder why the
    // scanner will not read the first digit.
    const unit = maxWidth / (modules + 20);
    const height = 26;

    let cursor = x + unit * 10;
    let bar = true;
    doc.save().fillColor('#000000');
    for (const width of widths) {
      const barWidth = width * unit;
      if (bar) doc.rect(cursor, y, barWidth, height).fill();
      cursor += barWidth;
      bar = !bar;
    }
    doc.restore();

    return y + height + 3;
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
