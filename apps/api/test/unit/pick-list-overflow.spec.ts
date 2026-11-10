import {
  PickListPdfService,
  type PickListPayload,
} from '../../src/modules/warehouse-printing/services/pick-list-pdf.service';

/**
 * The picking sheet's row heights.
 *
 * A batch of four parcels printed its four shipment references on two
 * lines — and the row was a fixed 34pt, so the second line was drawn
 * straight through the divider under it and came out of the printer
 * sliced in half. The picker got `SH-2026-11-0000` with the rest cut
 * off, which is exactly the lookup that line exists to save them.
 *
 * `ellipsis: true` did not save it: in pdfkit the option does nothing
 * unless `lineBreak: false` is set with it, so the string wrapped
 * instead of being truncated. Every single-line cell on the sheet had
 * only half of that pair.
 *
 * These tests pin the geometry, which is the part a reader of the code
 * cannot check by eye.
 */
function payload(over: Partial<PickListPayload> = {}): PickListPayload {
  return {
    batchNumber: 'PB-2026-11-000013',
    warehouseName: 'Kolkata Main',
    printedAtIso: '2026-11-09T05:30:35.000Z',
    printedByName: 'test',
    shipmentCount: 4,
    totalUnits: 4,
    strictMode: false,
    parcelsWithoutStock: [],
    lines: [
      {
        skuCode: 'Coffee',
        productName: 'Elite Collagen',
        variantName: null,
        quantity: 4,
        binCode: 'FLOOR',
        zoneName: 'Main',
        barcode: 'Coffee',
        strict: false,
        forShipments: [
          'SH-2026-11-000057',
          'SH-2026-11-000058',
          'SH-2026-11-000059',
          'SH-2026-11-000060',
        ],
      },
    ],
    ...over,
  };
}

/** Baseline y of every text-positioning operator on the page. */
async function textYs(p: PickListPayload): Promise<number[]> {
  const zlib = await import('node:zlib');
  const buf = await new PickListPdfService().render(p);
  const ys: number[] = [];
  for (const m of buf.toString('latin1').matchAll(/stream\r?\n([\s\S]*?)endstream/g)) {
    let text: string;
    try {
      text = zlib.inflateSync(Buffer.from(m[1] ?? '', 'latin1')).toString('latin1');
    } catch {
      continue;
    }
    for (const t of text.matchAll(/1 0 0 1 ([\d.]+) ([\d.]+) Tm/g)) ys.push(Number(t[2]));
  }
  return ys;
}

describe('PickListPdfService — a row is as tall as what it holds', () => {
  it('a row with four wrapped refs PUSHES the next row down', async () => {
    /*
      Measured on the row AFTER the growing one, because that is the
      thing the bug actually broke: a row that does not grow lets the
      next one start on top of it. An earlier version of this test
      compared divider positions and silently measured the header rule
      in both cases — it returned the same number whatever the input,
      which is a test that cannot fail.
    */
    const second = {
      ...payload().lines[0]!,
      skuCode: 'SECOND-ROW',
      forShipments: ['SH-2026-11-000099'],
    };
    const withFour = await textYs(payload({ lines: [payload().lines[0]!, second] }));
    const withOne = await textYs(
      payload({
        lines: [{ ...payload().lines[0]!, forShipments: ['SH-2026-11-000057'] }, second],
      }),
    );
    // PDF y grows upward, so "pushed down" means a smaller minimum y.
    expect(Math.min(...withFour.filter((y) => y > 60))).toBeLessThan(
      Math.min(...withOne.filter((y) => y > 60)),
    );
  });

  it('truncates a too-long product name onto ONE line instead of wrapping', async () => {
    /*
      `ellipsis` without `height` is dead code in pdfkit, so a long name
      wrapped down into the shipment references below it. Counted as
      TEXT BASELINES, because that is the thing that changes: a
      truncated name draws one, a wrapped one draws three. Asserting
      "nothing overlaps" instead looks like a test and passes happily on
      the broken output — two earlier attempts here did exactly that.
    */
    const short = await textYs(
      payload({ lines: [{ ...payload().lines[0]!, forShipments: ['SH-2026-11-000057'] }] }),
    );
    const long = await textYs(
      payload({
        lines: [
          {
            ...payload().lines[0]!,
            productName: 'Elite Collagen Marine Peptide Complex Advanced Formula Extra Strength',
            variantName: 'Family Pack of Twelve Sachets',
            forShipments: ['SH-2026-11-000057'],
          },
        ],
      }),
    );
    expect(long.length).toBe(short.length);
  });
});
