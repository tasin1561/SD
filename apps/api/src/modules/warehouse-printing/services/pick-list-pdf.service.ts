import { Injectable } from '@nestjs/common';
import PDFDocument from 'pdfkit';

export interface PickListLine {
  /** One row per VARIANT, not per order — a picker walks to a shelf
   *  once and takes everything the batch needs from it. */
  readonly skuCode: string;
  readonly productName: string;
  readonly variantName: string | null;
  /** Total across every parcel on the batch. */
  readonly quantity: number;
  /** Where to walk. Composed aisle-rack-shelf (BIN-4), or the warehouse
   *  floor when bin tracking is off. */
  readonly binCode: string;
  readonly zoneName: string | null;
  /** The SKU's own barcode, for scanning at the packing table. NULL in
   *  STRICT mode, where each unit carries its own serial instead. */
  readonly barcode: string | null;
  /** Which parcels this line is destined for — printed small, so a
   *  picker holding a short line knows which orders are affected. */
  readonly forShipments: readonly string[];
}

export interface PickListPayload {
  readonly batchNumber: string;
  readonly warehouseName: string;
  readonly printedAtIso: string;
  readonly printedByName: string;
  readonly shipmentCount: number;
  readonly totalUnits: number;
  readonly strictMode: boolean;
  readonly lines: readonly PickListLine[];
}

/**
 * The sheet a picker carries.
 *
 * Consolidated BY VARIANT and ordered by shelf location, because the
 * expensive part of picking is walking. A list ordered by order number
 * sends somebody up the same aisle four times.
 *
 * The barcode column is present only when the warehouse is in NORMAL
 * mode. In STRICT mode every unit carries its own serial and the scan at
 * the packing table is against THAT (UNIT-2) — printing a SKU barcode
 * there would invite scanning the wrong thing and having it accepted.
 */
@Injectable()
export class PickListPdfService {
  async render(payload: PickListPayload): Promise<Buffer> {
    return new Promise<Buffer>((resolve, reject) => {
      const doc = new PDFDocument({
        size: 'A4',
        margin: 36,
        info: { Title: `Picking list ${payload.batchNumber}`, Author: 'Skydrop' },
      });
      const chunks: Buffer[] = [];
      doc.on('data', (c: Buffer) => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);
      try {
        this.draw(doc, payload);
        doc.end();
      } catch (e) {
        reject(e instanceof Error ? e : new Error(String(e)));
      }
    });
  }

  private draw(doc: InstanceType<typeof PDFDocument>, p: PickListPayload): void {
    const left = 36;
    const right = doc.page.width - 36;

    doc.fontSize(16).font('Helvetica-Bold').text('PICKING LIST', left, 36);
    doc.fontSize(20).font('Helvetica-Bold').text(p.batchNumber, left, 54);

    doc.fontSize(8).font('Helvetica').fillColor('#333333');
    doc.text(
      `${p.warehouseName}   ·   ${p.shipmentCount} parcels   ·   ${p.totalUnits} units   ·   ` +
        `printed ${new Date(p.printedAtIso).toLocaleString('en-IN')} by ${p.printedByName}`,
      left,
      80,
      { width: right - left },
    );

    if (p.strictMode) {
      // Worth saying on the paper: in strict mode the picker must scan a
      // serial per unit, and a sheet that looks the same in both modes is
      // how somebody grabs the right SKU and the wrong unit.
      doc
        .fontSize(8)
        .font('Helvetica-Bold')
        .fillColor('#000000')
        .text('STRICT MODE — scan each unit serial; SKU barcodes are not shown', left, 94);
    }

    let y = p.strictMode ? 112 : 100;
    doc.moveTo(left, y).lineTo(right, y).lineWidth(1).strokeColor('#000000').stroke();
    y += 8;

    const cols = this.columns(left, right, p.strictMode);
    doc.fontSize(8).font('Helvetica-Bold').fillColor('#000000');
    doc.text('DONE', cols.tick, y);
    doc.text('LOCATION', cols.loc, y);
    doc.text('QTY', cols.qty, y);
    doc.text('SKU / PRODUCT', cols.sku, y);
    if (!p.strictMode) doc.text('BARCODE', cols.barcode, y);
    y += 12;
    doc.moveTo(left, y).lineTo(right, y).lineWidth(0.5).stroke();
    y += 6;

    for (const line of p.lines) {
      // A row is ~34pt; start a new page rather than run off the bottom.
      if (y > doc.page.height - 70) {
        doc.addPage();
        y = 40;
      }
      y = this.drawRow(doc, line, cols, y, p.strictMode, left, right);
    }

    doc.fontSize(7).font('Helvetica').fillColor('#666666');
    doc.text(
      `${p.batchNumber} — every line ticked means the trolley matches this sheet.`,
      left,
      doc.page.height - 48,
      { width: right - left },
    );
  }

  private columns(
    left: number,
    right: number,
    strict: boolean,
  ): { tick: number; loc: number; qty: number; sku: number; barcode: number; skuWidth: number } {
    const tick = left;
    const loc = left + 34;
    const qty = loc + 92;
    const sku = qty + 32;
    const barcode = right - 108;
    return { tick, loc, qty, sku, barcode, skuWidth: (strict ? right : barcode - 8) - sku };
  }

  private drawRow(
    doc: InstanceType<typeof PDFDocument>,
    line: PickListLine,
    cols: ReturnType<PickListPdfService['columns']>,
    y: number,
    strict: boolean,
    left: number,
    right: number,
  ): number {
    // A real tick box. The sheet is the picker's working memory and a
    // half-done walk needs somewhere to record itself.
    doc
      .rect(cols.tick, y + 1, 11, 11)
      .lineWidth(0.75)
      .strokeColor('#000000')
      .stroke();

    doc.fontSize(11).font('Helvetica-Bold').fillColor('#000000');
    doc.text(line.binCode, cols.loc, y, { width: 88, ellipsis: true });
    if (line.zoneName !== null) {
      doc.fontSize(6).font('Helvetica').fillColor('#666666');
      doc.text(line.zoneName, cols.loc, y + 13, { width: 88, ellipsis: true });
    }

    doc.fontSize(14).font('Helvetica-Bold').fillColor('#000000');
    doc.text(String(line.quantity), cols.qty, y - 1, { width: 28 });

    doc.fontSize(9).font('Helvetica-Bold');
    doc.text(line.skuCode, cols.sku, y, { width: cols.skuWidth, ellipsis: true });
    doc.fontSize(8).font('Helvetica').fillColor('#333333');
    const name =
      line.variantName === null ? line.productName : `${line.productName} — ${line.variantName}`;
    doc.text(name, cols.sku, y + 11, { width: cols.skuWidth, ellipsis: true });

    if (!strict) {
      doc.fontSize(9).font('Courier').fillColor('#000000');
      doc.text(line.barcode ?? '—', cols.barcode, y + 2, { width: 104, ellipsis: true });
    }

    // Which parcels need it — small, and only when it is short enough to
    // be useful. A line for fourteen parcels is noise on paper.
    if (line.forShipments.length > 0 && line.forShipments.length <= 4) {
      doc.fontSize(6).font('Helvetica').fillColor('#666666');
      doc.text(line.forShipments.join('  '), cols.sku, y + 21, {
        width: cols.skuWidth,
        ellipsis: true,
      });
    }

    const next = y + (line.forShipments.length > 0 && line.forShipments.length <= 4 ? 34 : 28);
    doc
      .moveTo(left, next - 4)
      .lineTo(right, next - 4)
      .lineWidth(0.25)
      .strokeColor('#cccccc')
      .stroke();
    return next;
  }
}
