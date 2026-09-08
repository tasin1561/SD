import {
  PickListPdfService,
  type PickListPayload,
} from '../../src/modules/warehouse-printing/services/pick-list-pdf.service';

/**
 * The picking sheet's barcode column.
 *
 * It printed the code as MONOSPACE TEXT for months, which looks like a
 * barcode column on screen and is unscannable on paper — the picker
 * types it, or gives up and reads the SKU. These tests pin the two
 * things that make the bars worth printing: that they exist at all, and
 * that they are wide enough to read.
 */
function payload(over: Partial<PickListPayload> = {}): PickListPayload {
  return {
    batchNumber: 'PB-2026-09-000003',
    warehouseName: 'Kolkata Main',
    printedAtIso: '2026-09-08T12:49:20.000Z',
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
        forShipments: ['SH-2026-09-000021'],
      },
    ],
    ...over,
  };
}

/** Bars are `re` fill operations; text is not. Counting them is the only
 *  way to tell a drawn symbol from a printed string in a PDF. */
async function barCount(p: PickListPayload): Promise<number> {
  const zlib = await import('node:zlib');
  const buf = await new PickListPdfService().render(p);
  const streams = /stream\r?\n([\s\S]*?)endstream/g;
  let count = 0;
  for (const m of buf.toString('latin1').matchAll(streams)) {
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

describe('PickListPdfService — the barcode is a barcode (LBL-1/LBL-3)', () => {
  it('draws bars for a normal-mode line', async () => {
    // The tick box is a rect too, so "more than a handful" is the signal
    // — a Code 128 symbol is ~100 bars.
    expect(await barCount(payload())).toBeGreaterThan(50);
  });

  it('draws NO bars in strict mode', async () => {
    // UNIT-2: each unit carries its own serial and the scan is against
    // THAT. A SKU barcode here invites scanning the right product and
    // the wrong unit, and having it accepted.
    const bars = await barCount(payload({ strictMode: true }));
    expect(bars).toBeLessThan(10);
  });

  it('a real SKU prints wide enough for a warehouse scanner', () => {
    const pt = PickListPdfService.moduleWidthPt('AVIATO-BLAC-BLAC');
    expect(pt).not.toBeNull();
    // 0.55pt ≈ 0.19mm is the floor off a laser print.
    expect(pt as number).toBeGreaterThanOrEqual(0.55);
  });

  it('refuses to print a symbol too dense to read', async () => {
    // A symbol below the floor is worse than none: it looks scannable
    // and reads intermittently, which a packer experiences as a broken
    // scanner rather than as a sheet that cannot be scanned.
    const long = 'A-VERY-LONG-SKU-CODE-THAT-KEEPS-GOING-1234';
    expect(PickListPdfService.moduleWidthPt(long) as number).toBeLessThan(0.55);
    const bars = await barCount(payload({ lines: [{ ...payload().lines[0]!, barcode: long }] }));
    expect(bars).toBeLessThan(10);
  });
});
