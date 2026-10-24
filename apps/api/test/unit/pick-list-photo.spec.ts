import {
  PickListPdfService,
  type PickListPayload,
} from '../../src/modules/warehouse-printing/services/pick-list-pdf.service';

/**
 * The picking sheet's product picture.
 *
 * A picker recognises a product by sight long before they parse a SKU
 * code, and two colourways of one product differ by one word in the name
 * and by everything in the photograph. The sheet printed neither for a
 * year — the picture was wired for every SCREEN that lists a product and
 * for none of the paper the floor actually works from.
 *
 * What these pin is the part that can quietly go wrong: that the picture
 * reaches the page at all, and that a bad one costs its own line and
 * nothing else.
 */
const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

function payload(over: Partial<PickListPayload> = {}): PickListPayload {
  return {
    batchNumber: 'PB-2026-09-000009',
    warehouseName: 'Kolkata Main',
    printedAtIso: '2026-10-24T07:20:03.000Z',
    printedByName: 'test',
    shipmentCount: 1,
    totalUnits: 1,
    strictMode: false,
    parcelsWithoutStock: [],
    lines: [
      {
        skuCode: 'AVIATO-BLAC-BLAC',
        productName: 'Aviator OG Sunglasses',
        variantName: 'Black / Black',
        quantity: 1,
        binCode: 'FLOOR',
        zoneName: 'Main',
        barcode: 'AVIATO-BLAC-BLAC',
        strict: false,
        forShipments: ['SH-2026-09-000043'],
        imagePng: PNG_1X1,
      },
    ],
    ...over,
  };
}

/** Bars are `re` fill operations, the same count the barcode spec uses —
 *  here to prove the narrower product column did not cost the symbol. */
async function barCount(buf: Buffer): Promise<number> {
  const zlib = await import('node:zlib');
  let count = 0;
  for (const m of buf.toString('latin1').matchAll(/stream\r?\n([\s\S]*?)endstream/g)) {
    let text: string;
    try {
      text = zlib.inflateSync(Buffer.from(m[1] ?? '', 'latin1')).toString('latin1');
    } catch {
      continue;
    }
    count += [...text.matchAll(/[\d.]+ [\d.]+ [\d.]+ [\d.]+ re/g)].length;
  }
  return count;
}

describe('PickListPdfService — the product picture', () => {
  it('embeds the picture when a line carries one', async () => {
    const buf = await new PickListPdfService().render(payload());
    expect(buf.toString('latin1')).toContain('/Subtype /Image');
  });

  it('prints the sheet unchanged when no product has a picture', async () => {
    // The column only exists when there is something to put in it: a
    // seller who has photographed nothing keeps the full width for the
    // product name, exactly as the sheet printed before today.
    const none = payload({ lines: [{ ...payload().lines[0]!, imagePng: null }] });
    const buf = await new PickListPdfService().render(none);
    expect(buf.toString('latin1')).not.toContain('/Subtype /Image');
    expect(buf.subarray(0, 5).toString()).toBe('%PDF-');
  });

  it('a corrupt picture costs its own line, never the sheet', async () => {
    // Same rule as an unencodable barcode (LBL-3). A picker standing at
    // a printer must not be told "no sheet" because one product
    // photograph is damaged.
    const bad = payload({
      lines: [{ ...payload().lines[0]!, imagePng: Buffer.from('not an image') }],
    });
    const buf = await new PickListPdfService().render(bad);
    expect(buf.subarray(0, 5).toString()).toBe('%PDF-');
  });

  it('keeps the barcode scannable beside the picture', async () => {
    // The picture's width comes out of the LOCATION column, not out of
    // the barcode — a symbol narrowed to make room reads intermittently,
    // which a packer experiences as a broken scanner.
    expect(await barCount(await new PickListPdfService().render(payload()))).toBeGreaterThan(50);
  });
});
