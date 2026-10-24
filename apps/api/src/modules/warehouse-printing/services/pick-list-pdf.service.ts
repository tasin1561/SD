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
  /** The SKU's own barcode, for scanning at the packing table. NULL for
   *  a STRICT product, where each unit carries its own serial instead. */
  readonly barcode: string | null;
  /** This line's product runs in STRICT mode: no SKU barcode is printed
   *  for it, and its cell tells the picker to scan each unit's serial. */
  readonly strict: boolean;
  /** Which parcels this line is destined for — printed small, so a
   *  picker holding a short line knows which orders are affected. */
  readonly forShipments: readonly string[];
  /**
   * The product's picture, as PNG bytes ready to embed.
   *
   * A picker recognises a product by sight long before they parse a SKU
   * code, and two variants of one product differ by a word in a name and
   * by everything in a photograph. Null when the seller has uploaded no
   * image, or when the fetch failed — the sheet prints either way
   * (`CatalogReadService.printableThumbnailsByVariant` fails open).
   */
  readonly imagePng?: Buffer | null;
}

export interface PickListPayload {
  readonly batchNumber: string;
  readonly warehouseName: string;
  readonly printedAtIso: string;
  readonly printedByName: string;
  readonly shipmentCount: number;
  readonly totalUnits: number;
  /** True when ANY line is a STRICT product. */
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
 * The barcode is decided PER PRODUCT (owner, 2026-09-15). A NORMAL
 * product carries its SKU barcode; a STRICT product carries none — every
 * unit has its own serial and the scan at the packing table is against
 * THAT (UNIT-2), so a SKU barcode beside it would invite scanning the
 * wrong thing and having it accepted. Its cell says so in words instead,
 * which is what stops a mixed sheet being read as "scan the SKU" for
 * every line. The column exists whenever any line is NORMAL.
 *
 * The PICTURE (2026-10-24) follows the same shape: its column exists
 * whenever any line has one. Every screen that lists a product has shown
 * its photograph since 2026-09-13 and the paper the floor actually works
 * from showed none — so a picker matched a shelf against a SKU code,
 * which is the one thing on the sheet that two colourways of a product
 * share almost all of.
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

    const showBarcodes = p.lines.some((l) => !l.strict);
    if (p.strictMode) {
      // Worth saying on the paper: a strict product needs a serial scanned
      // per unit, and a sheet that looks the same for both kinds is how
      // somebody grabs the right SKU and the wrong unit.
      doc
        .fontSize(8)
        .font('Helvetica-Bold')
        .fillColor('#000000')
        .text(
          showBarcodes
            ? 'Lines marked STRICT: scan each unit serial — no SKU barcode is shown for them'
            : 'STRICT MODE — scan each unit serial; SKU barcodes are not shown',
          left,
          94,
        );
    }

    let y = p.strictMode ? 112 : 100;
    doc.moveTo(left, y).lineTo(right, y).lineWidth(1).strokeColor('#000000').stroke();
    y += 8;

    // The picture column exists only when there is a picture to put in
    // it. A sheet of products nobody has photographed keeps the width
    // for the product name, exactly as it printed before.
    const showImages = p.lines.some((l) => l.imagePng != null);

    const cols = this.columns(left, right, !showBarcodes, showImages);
    doc.fontSize(8).font('Helvetica-Bold').fillColor('#000000');
    doc.text('DONE', cols.tick, y);
    doc.text('LOCATION', cols.loc, y);
    doc.text('QTY', cols.qty, y);
    if (showImages) doc.text('ITEM', cols.image, y);
    doc.text('SKU / PRODUCT', cols.sku, y);
    if (showBarcodes) doc.text('BARCODE', cols.barcode, y);
    y += 12;
    doc.moveTo(left, y).lineTo(right, y).lineWidth(0.5).stroke();
    y += 6;

    for (const line of p.lines) {
      // A row is ~34pt; start a new page rather than run off the bottom.
      if (y > doc.page.height - 70) {
        doc.addPage();
        y = 40;
      }
      y = this.drawRow(doc, line, cols, y, showBarcodes, showImages, left, right);
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
    images: boolean,
  ): {
    tick: number;
    loc: number;
    locWidth: number;
    qty: number;
    image: number;
    sku: number;
    barcode: number;
    skuWidth: number;
  } {
    const tick = left;
    const loc = left + 34;
    /*
      The location column gives up 16pt when pictures are printing.

      A bin code is `A-01-03` or `FLOOR` — short, and it was printing at
      11pt into 88pt of space it never used. The product NAME is what
      runs long, so the width the picture costs comes from here rather
      than from the one column where a truncation loses information.
    */
    const locWidth = images ? 70 : 88;
    const qty = loc + locWidth + 4;
    const image = qty + 32;
    const sku = image + (images ? IMAGE_COLUMN_WIDTH + 4 : 0);
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
    return {
      tick,
      loc,
      locWidth,
      qty,
      image,
      sku,
      barcode,
      skuWidth: (strict ? right : barcode - 10) - sku,
    };
  }

  private drawRow(
    doc: InstanceType<typeof PDFDocument>,
    line: PickListLine,
    cols: ReturnType<PickListPdfService['columns']>,
    y: number,
    showBarcodes: boolean,
    showImages: boolean,
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
    doc.text(line.binCode, cols.loc, y, { width: cols.locWidth, ellipsis: true });
    if (line.zoneName !== null) {
      doc.fontSize(6).font('Helvetica').fillColor('#666666');
      doc.text(line.zoneName, cols.loc, y + 13, { width: cols.locWidth, ellipsis: true });
    }

    doc.fontSize(14).font('Helvetica-Bold').fillColor('#000000');
    doc.text(String(line.quantity), cols.qty, y - 1, { width: 28 });

    const drewImage = showImages && this.drawImageCell(doc, line.imagePng, cols.image, y);

    doc.fontSize(9).font('Helvetica-Bold');
    doc.text(line.skuCode, cols.sku, y, { width: cols.skuWidth, ellipsis: true });
    doc.fontSize(8).font('Helvetica').fillColor('#333333');
    const name =
      line.variantName === null ? line.productName : `${line.productName} — ${line.variantName}`;
    doc.text(name, cols.sku, y + 11, { width: cols.skuWidth, ellipsis: true });

    const drawsBars = showBarcodes && !line.strict;
    if (drawsBars) {
      this.drawBarcodeCell(doc, line.barcode, cols.barcode, y);
    } else if (showBarcodes) {
      // A STRICT line on a sheet that has a barcode column: say what to
      // scan instead, so an empty cell is never read as "no barcode yet".
      doc.fontSize(8).font('Helvetica-Bold').fillColor('#000000');
      doc.text('STRICT — scan each unit', cols.barcode, y + 2, { width: BARCODE_COLUMN_WIDTH });
    }

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

    // A row that draws bars is always full height: the bars plus the
    // value printed under them need it, and a row that shrinks to fit
    // would put the next line's location on top of this one's barcode.
    // A strict row draws none, so the old height stands.
    const next = y + (drawsBars || hasShipmentLine || drewImage ? ROW_HEIGHT : 28);
    doc
      .moveTo(left, next - 4)
      .lineTo(right, next - 4)
      .lineWidth(0.25)
      .strokeColor('#cccccc')
      .stroke();
    return next;
  }

  /**
   * The product's picture, boxed, or nothing at all.
   *
   * Returns whether it drew, because a row carrying a picture is always
   * full height — a 28pt row would run its image through the divider
   * and into the next line's bin code.
   *
   * NEVER throws. pdfkit rejects an image it cannot decode by throwing,
   * and one unreadable photograph must not cost a picker the other forty
   * lines on the sheet (same rule as an unencodable barcode, LBL-3).
   */
  private drawImageCell(
    doc: InstanceType<typeof PDFDocument>,
    png: Buffer | null | undefined,
    x: number,
    y: number,
  ): boolean {
    if (png == null || png.length === 0) return false;
    try {
      doc.image(png, x, y + 1, {
        fit: [IMAGE_COLUMN_WIDTH, IMAGE_HEIGHT],
        align: 'center',
        valign: 'center',
      });
    } catch {
      return false;
    }
    // A hairline box, so a product photographed against white still
    // reads as a picture of something rather than as a printing gap.
    doc
      .rect(x, y + 1, IMAGE_COLUMN_WIDTH, IMAGE_HEIGHT)
      .lineWidth(0.25)
      .strokeColor('#cccccc')
      .stroke();
    return true;
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
/** The picture: square, and as big as a 34pt row has room for. Small
 *  enough to cost the product name little, large enough to tell two
 *  colourways of one sunglass apart at arm's length. */
const IMAGE_COLUMN_WIDTH = 28;
const IMAGE_HEIGHT = 28;
const BAR_HEIGHT = 17;
const ROW_HEIGHT = 34;
/** ~0.19mm, the narrowest bar a warehouse scanner reads reliably off a
 *  laser print. Below this we print the value and no symbol. */
const MIN_MODULE_PT = 0.55;
