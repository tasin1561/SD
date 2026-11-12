import { writeFileSync } from 'node:fs';
import {
  formatStamp,
  renderShippingLabel,
  type ShippingLabelData,
} from '../../src/modules/courier-awb/services/skydrop-label-pdf.service';
import { extractPdfText } from './helpers/pdf-text';

/**
 * The label we render ourselves. The masthead carries the SELLER's name
 * (the whole reason it exists), the hub's two machine-read values are on
 * it, and a parcel with more lines than fit says so instead of
 * overprinting the barcode.
 */

const BASE: ShippingLabelData = {
  sellerName: 'Menev Store',
  awbNumber: '38061110633721',
  courierName: 'Delhivery',
  accountName: 'MS Exports',
  sortCode: 'KLT/MDH',
  destinationPin: '700128',
  recipientName: 'Ismail Sk',
  recipientPhone: '9876543210',
  recipientAddress:
    'Village: Sultan Pur, Post Office (PO): Bahadurpur, Police Station (PS): Bhagwangola, District: Murshidabad, State: West Bengal',
  isCod: true,
  amountInr: '1,050.00',
  items: [
    {
      productName: 'Aviator OG Sunglass',
      skuCode: 'MST-SUNG-01',
      quantity: 1,
      lineTotalInr: '1,050.00',
    },
  ],
  totalInr: '1,050.00',
  orderReference: 'testing12',
  generatedAt: new Date('2026-11-12T13:25:00Z'),
};

async function textOf(data: ShippingLabelData): Promise<string> {
  const bytes = await renderShippingLabel(data);
  return extractPdfText(bytes);
}

describe('the shipping label we render ourselves', () => {
  it('puts the SELLER on the masthead, not Skydrop', async () => {
    const text = await textOf(BASE);
    expect(text).toContain('MENEV STORE');
    // The reason the whole renderer exists: Delhivery's own sheet says
    // Skydrop here because the account name is fixed per client.
    expect(text).not.toContain('SKYDROP');
  });

  it('leads with the account the courier knows us by, then the client', async () => {
    // Owner, 2026-11-12: Delhivery's own people read "MS EXPORTS" and
    // they read left to right, so it goes first — and both names are
    // ONE string at ONE size, which is what "equal importance" means.
    const text = await textOf(BASE);
    expect(text).toContain('MS EXPORTS / MENEV STORE');
  });

  it('still reads correctly when no account name is configured', async () => {
    const text = await textOf({ ...BASE, accountName: null });
    expect(text).toContain('MENEV STORE');
    // No orphaned separator where the account name would have been.
    expect(text).not.toMatch(/^\s*\//m);
    expect(text).not.toContain('/ MENEV STORE');
  });

  it('carries the two values the hub machine-reads: the AWB and the sort code', async () => {
    const text = await textOf(BASE);
    expect(text).toContain('38061110633721');
    expect(text).toContain('KLT/MDH');
  });

  it('shouts when the sort code is missing instead of printing a blank', async () => {
    // A blank reads as "this label has no sort code"; a warning reads as
    // "ask someone before this goes on a van".
    const text = await textOf({ ...BASE, sortCode: null });
    expect(text).toContain('NO SORT CODE');
  });

  it('shows the amount being COLLECTED on a COD parcel', async () => {
    const text = await textOf(BASE);
    expect(text).toContain('COD');
    expect(text).toContain('1,050.00');
    expect(text).not.toContain('DO NOT COLLECT');
  });

  it('tells the rider NOT to collect on a prepaid parcel', async () => {
    const text = await textOf({ ...BASE, isCod: false });
    expect(text).toContain('PREPAID');
    expect(text).toContain('DO NOT COLLECT');
  });

  it('puts the SELLER’s own reference in the second barcode, never ours', async () => {
    const text = await textOf(BASE);
    expect(text).toContain('testing12');
    expect(text).not.toContain('SH-2026');
  });

  it('names the lines it could not fit rather than overprinting them', async () => {
    const many = Array.from({ length: 40 }, (_, i) => ({
      productName: `Product number ${i + 1} with a fairly long name`,
      skuCode: `SKU-${i + 1}`,
      quantity: i + 1,
      lineTotalInr: '99.00',
    }));
    const text = await textOf({ ...BASE, items: many });
    expect(text).toMatch(/\+ \d+ more lines/);
    // The footer must survive: the barcode and total are what the bench
    // and the hub need, and they sit BELOW the table.
    expect(text).toContain('testing12');
    expect(text).toContain('TOTAL');
  });

  it('prints NO return address — a deliberate absence, not an oversight', async () => {
    // Owner's call (2026-11-12). An RTO is routed from the AWB by the
    // courier's own system, so printed text never made a return work —
    // and the sheet is the seller's brand in their customer's hands.
    // This test exists so adding one back is a decision, not a drive-by.
    const text = await textOf(BASE);
    expect(text).not.toMatch(/RETURN TO/i);
  });

  it('stamps the time in IST, where the parcel actually is', () => {
    // 13:25 UTC is 18:55 IST on the same day.
    expect(formatStamp(new Date('2026-11-12T13:25:00Z'))).toBe('12-Nov-2026 | 6:55 PM');
  });

  it('renders a real PDF', async () => {
    const bytes = await renderShippingLabel(BASE);
    expect(bytes.subarray(0, 5).toString()).toBe('%PDF-');
    expect(bytes.length).toBeGreaterThan(800);
    if (process.env['LABEL_PDF_OUT'] !== undefined) {
      writeFileSync(process.env['LABEL_PDF_OUT'], bytes);
    }
  });
});
