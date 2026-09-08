import { Injectable } from '@nestjs/common';
import PDFDocument from 'pdfkit';
import { code128ModuleWidth, drawCode128 } from '../../../common/barcode/pdf-barcode';

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
  /**
   * Parcels in this batch with nothing reserved to pick.
   *
   * Named on the sheet rather than silently omitted. A picker holding a
   * page that says "1 parcel" above an empty table has no way to tell a
   * printing fault from an order with no stock claimed, and the second
   * is a real state: SD-2026-26-000003 reached a batch in PENDING_PICK
   * after the TTL sweep had released both its reservations.
   */
  readonly parcelsWithoutStock: readonly string[];
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

    if (p.lines.length === 0) {
      // NEVER an empty table. A sheet with a header and no rows reads as
      // a printer fault, and the picker's next move is to print it
      // again — which produces the same page.
      doc.fontSize(10).font('Helvetica-Bold').fillColor('#000000');
      doc.text('Nothing to pick on this sheet.', left, y + 8, { width: right - left });
      y += 24;
      doc.fontSize(8).font('Helvetica').fillColor('#333333');
      doc.text(
        'No stock is reserved against these parcels, so there is nothing to walk for. ' +
          'This is not a printing fault — do not reprint. Take it to a supervisor: the ' +
          'orders need their stock re-checked before they can be picked.',
        left,
        y,
        { width: right - left },
      );
      y += 34;
    }

    if (p.parcelsWithoutStock.length > 0 && p.lines.length > 0) {
      // Some lines printed, but not for every parcel. Worth saying at
      // the desk rather than being discovered at the pack bench with a
      // box that cannot be filled.
      doc.fontSize(8).font('Helvetica-Bold').fillColor('#000000');
      doc.text(
        `${p.parcelsWithoutStock.length} parcel(s) on this batch have nothing reserved: ` +
          `${p.parcelsWithoutStock.join(', ')}`,
        left,
        y + 6,
        { width: right - left },
      );
      y += 22;
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
    /*
      WIDE ENOUGH TO SCAN, which is a measured constraint and not a
      layout preference. A Code 128 symbol for a 16-character SKU is
      ~231 modules including quiet zones; at the old 104pt column each
      module printed 0.45pt — 0.16mm — well under the ~0.19mm a
      warehouse scanner needs off a laser print. It would not have
      failed cleanly either: a too-narrow symbol reads intermittently,
      which reads to a packer as a broken scanner.
    */
    const barcode = right - BARCODE_COLUMN_WIDTH;
    return { tick, loc, qty, sku, barcode, skuWidth: (strict ? right : barcode - 10) - sku };
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

    if (!strict) this.drawBarcodeCell(doc, line.barcode, cols.barcode, y);

    // Which parcels need it — small, and only when it is short enough to
    // be useful. A line for fourteen parcels is noise on paper.
    const hasShipmentLine = line.forShipments.length > 0 && line.forShipments.length <= 4;
    if (hasShipmentLine) {
      doc.fontSize(6).font('Helvetica').fillColor('#666666');
      doc.text(line.forShipments.join('  '), cols.sku, y + 21, {
        width: cols.skuWidth,
        ellipsis: true,
      });
    }

    // A non-strict row is always full height: the bars plus the value
    // printed under them need it, and a row that shrinks to fit would
    // put the next line's location on top of this one's barcode. In
    // strict mode there is no barcode cell, so the old height stands.
    const next = y + (!strict || hasShipmentLine ? ROW_HEIGHT : 28);
    doc
      .moveTo(left, next - 4)
      .lineTo(right, next - 4)
      .lineWidth(0.25)
      .strokeColor('#cccccc')
      .stroke();
    return next;
  }

  /**
   * The barcode cell: bars, with the value printed underneath.
   *
   * BOTH, always. The bars are what gets scanned and the text is what
   * gets read aloud when a scanner is flat or a label is scuffed —
   * omitting the text turns a five-second problem into a trip back to a
   * screen. An unencodable value falls back to the text alone (LBL-3):
   * one bad SKU must not cost the sheet its other forty barcodes.
   */
  private drawBarcodeCell(
    doc: InstanceType<typeof PDFDocument>,
    value: string | null,
    x: number,
    y: number,
  ): void {
    if (value === null) {
      doc.fontSize(8).font('Courier').fillColor('#666666');
      doc.text('—', x, y + 8, { width: BARCODE_COLUMN_WIDTH });
      return;
    }

    /*
      TOO DENSE IS THE SAME AS UNENCODABLE, and it fails worse.

      An unusually long SKU squeezes the symbol below the module width a
      warehouse scanner can resolve off a laser print — a 42-character
      code lands at 0.11mm against a ~0.19mm floor. Printed anyway it
      LOOKS like a barcode and reads about one time in four, which a
      packer experiences as a faulty gun rather than as a sheet that
      cannot be scanned. So past the floor we print the value alone and
      let them type it, which is slower and works.
    */
    const modulePt = code128ModuleWidth(value, BARCODE_COLUMN_WIDTH);
    const drawn =
      modulePt !== null &&
      modulePt >= MIN_MODULE_PT &&
      drawCode128(doc, {
        value,
        x,
        y: y + 1,
        width: BARCODE_COLUMN_WIDTH,
        height: BAR_HEIGHT,
      });

    doc.fontSize(6.5).font('Courier').fillColor('#000000');
    doc.text(value, x, drawn ? y + BAR_HEIGHT + 3 : y + 8, {
      width: BARCODE_COLUMN_WIDTH,
      align: 'center',
      ellipsis: true,
    });
  }

  /**
   * Whether a value will print narrow enough to be a problem.
   *
   * Exposed for the tests rather than used at render time: the answer
   * depends on SKU length, so the useful moment to know is when somebody
   * changes the column width, not when a picker is standing at a shelf.
   */
  static moduleWidthPt(value: string): number | null {
    return code128ModuleWidth(value, BARCODE_COLUMN_WIDTH);
  }
}

/** Points. A4 minus margins is 523pt wide; this is what is left after
 *  the location, quantity and product columns have what they need. */
const BARCODE_COLUMN_WIDTH = 165;
const BAR_HEIGHT = 17;
const ROW_HEIGHT = 34;
/** ~0.19mm, the narrowest bar a warehouse scanner reads reliably off a
 *  laser print. Below this we print the value and no symbol. */
const MIN_MODULE_PT = 0.55;
