import { PDFDocument } from 'pdf-lib';
import { LabelSheetService } from '../../src/modules/warehouse-printing/services/label-sheet.service';
import {
  ManualLabelPdfService,
  type ManualLabelPayload,
} from '../../src/modules/warehouse-printing/services/manual-label-pdf.service';

/**
 * The shipping label is 4x6, whatever it came in as.
 *
 * The sources disagree about paper — Delhivery hands back whatever their
 * account is set to, and ours used to be four-up on A4. One stack of
 * three different page sizes is either refused by a label printer or
 * silently scaled per page, and a barcode scaled by an amount nobody
 * chose is one that may not read. The picking list stays A4; it is a
 * document somebody reads while walking, not a sticker.
 */
const LABEL: ManualLabelPayload = {
  awbNumber: 'SD-MANUAL-0001',
  courierName: 'Local courier',
  orderNumber: 'SD-2026-26-000009',
  sellerCompanyName: 'QA Test Traders',
  recipientName: 'A Customer',
  recipientPhone: '+919000000000',
  addressLine1: '12 Some Road, off the main bazaar',
  addressLine2: 'Opposite the water tank',
  city: 'Bengaluru',
  stateProvince: 'Karnataka',
  postalCode: '560001',
  isCod: true,
  codAmountInr: '1499.00',
  weightGrams: 450,
  items: [{ name: 'Aviator OG Sunglasses', skuCode: 'AVIATO-BLAC-BLAC', quantity: 1 }],
};

/** A page with real content — pdf-lib refuses to embed an empty one. */
async function page(w: number, h: number): Promise<Buffer> {
  const d = await PDFDocument.create();
  d.addPage([w, h]).drawRectangle({ x: 10, y: 10, width: w - 20, height: h - 20 });
  return Buffer.from(await d.save());
}

async function sizes(pdf: Buffer): Promise<string[]> {
  const d = await PDFDocument.load(pdf);
  return d.getPages().map((p) => `${Math.round(p.getWidth())}x${Math.round(p.getHeight())}`);
}

describe('shipping labels are 4x6', () => {
  it('our own label is one per 4x6 page, never four to a sheet', async () => {
    // Four on one sheet means a single mis-cut puts a waybill on the
    // wrong parcel, which is the one thing a label must not be.
    const pdf = await new ManualLabelPdfService().render([LABEL, LABEL, LABEL]);
    expect(await sizes(pdf)).toEqual(['288x432', '288x432', '288x432']);
  });

  it("normalises a courier's A4 label onto 4x6", async () => {
    const merged = await new LabelSheetService().merge([
      { shipmentId: 'a4', bytes: await page(595, 842) },
    ]);
    expect(await sizes(merged.pdf)).toEqual(['288x432']);
    expect(merged.failed).toEqual([]);
  });

  it('a mixed stack comes out one size', async () => {
    const manual = await new ManualLabelPdfService().render([LABEL]);
    const merged = await new LabelSheetService().merge([
      { shipmentId: 'a4', bytes: await page(595, 842) },
      { shipmentId: 'already-4x6', bytes: await page(288, 432) },
      { shipmentId: 'manual', bytes: manual },
    ]);
    expect(await sizes(merged.pdf)).toEqual(['288x432', '288x432', '288x432']);
    expect(merged.failed).toEqual([]);
  });

  it('reports a label it could not merge rather than dropping it', async () => {
    // A short stack is indistinguishable from a complete one once it is
    // on the bench, and the parcel with no label is the one that ships
    // to nobody.
    const merged = await new LabelSheetService().merge([
      { shipmentId: 'broken', bytes: Buffer.from('not a pdf') },
    ]);
    expect(merged.failed).toEqual(['broken']);
  });
});
