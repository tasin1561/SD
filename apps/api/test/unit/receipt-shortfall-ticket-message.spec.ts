import {
  affectedLines,
  formatCountDate,
  receiptShortfallOpeningMessage,
  receiptShortfallSubject,
  receiptSurplusNotice,
  shortOf,
  surplusLines,
  type ReceiptShortfallFacts,
} from '../../src/modules/inventory-receipt/services/receipt-shortfall-ticket-message';

/**
 * TKT-3 — the words we write when a count comes up short.
 *
 * The fixture is production's GR-2026-08-0004 exactly as it stands: the
 * Dhaka intake leg of CN-2026-08-000003 for Menev Store, counted on
 * 19 Aug 2026, one line two short and one line three over. The whole
 * message is pinned, because it is what the backfill will write on the
 * first real ticket of this kind.
 */
const GR_2026_08_0004: ReceiptShortfallFacts = {
  consignmentNumber: 'CN-2026-08-000003',
  receiptNumber: 'GR-2026-08-0004',
  warehouse: { code: 'DAC-01', name: 'Dhaka Intake', timezone: 'Asia/Dhaka' },
  originWarehouse: null,
  receivedAt: new Date('2026-08-19T15:16:34.199Z'),
  leg: 'SELLER_TO_FIRST_WAREHOUSE',
  lines: [
    {
      productName: 'Aviator OG Sunglass',
      variantLabel: 'Green / Black',
      skuCode: 'AVIATO-GREE-BLAC',
      expectedQty: 200,
      receivedQty: 198,
      damagedQty: 0,
    },
    {
      productName: 'Aviator OG Sunglass',
      variantLabel: 'Black / Black',
      skuCode: 'AVIATO-BLAC-BLAC',
      expectedQty: 100,
      receivedQty: 103,
      damagedQty: 0,
    },
  ],
};

describe('receipt shortfall ticket message', () => {
  it('writes the whole opening message for GR-2026-08-0004', () => {
    expect(
      receiptShortfallOpeningMessage({ ...GR_2026_08_0004, ticketNumber: 'TK-2026-000004' }),
    ).toBe(
      [
        'Ticket TK-2026-000004 — we opened this for you because goods receipt GR-2026-08-0004 came up short.',
        '',
        'Consignment CN-2026-08-000003 · receipt GR-2026-08-0004',
        'Counted at DAC-01 (Dhaka Intake) on 19 Aug 2026.',
        '',
        'Aviator OG Sunglass — Green / Black (AVIATO-GREE-BLAC): declared 200 · counted 198 · damaged 0 · short 2',
        '',
        'Where the 2 units went missing: between you and our first warehouse. You declared more than we counted when the goods reached DAC-01 (Dhaka Intake). Please check your packing list and reply below — confirm our count, or dispute it and tell us why (a photo of the packed cartons helps).',
        '',
        'Nothing is on hold because of this: the units we counted carry on as normal, and no money moves unless this ticket is settled with a refund.',
      ].join('\n'),
    );
  });

  it('names only the short line — the surplus line is a notification, not the ticket', () => {
    expect(affectedLines(GR_2026_08_0004.lines).map((l) => l.skuCode)).toEqual([
      'AVIATO-GREE-BLAC',
    ]);
    expect(receiptShortfallSubject(GR_2026_08_0004)).toBe('CN-2026-08-000003: 2 short at DAC-01');
  });

  it('tells the seller about the surplus in its own notice', () => {
    expect(surplusLines(GR_2026_08_0004.lines).map((l) => l.skuCode)).toEqual(['AVIATO-BLAC-BLAC']);
    expect(receiptSurplusNotice(GR_2026_08_0004)).toEqual({
      title: '3 more AVIATO-BLAC-BLAC than declared arrived at Dhaka Intake',
      body: [
        'Consignment CN-2026-08-000003, goods receipt GR-2026-08-0004, counted at DAC-01 (Dhaka Intake):',
        'Aviator OG Sunglass — Black / Black (AVIATO-BLAC-BLAC): declared 100, counted 103 — 3 more.',
        'The extra units carry on with the rest of your goods. Nothing for you to do.',
      ].join('\n'),
    });
  });

  it('a damaged unit is not ALSO a missing one', () => {
    // received_qty counts GOOD units; damaged ones are recorded beside it.
    const l = {
      productName: 'Mug',
      variantLabel: null,
      skuCode: 'MUG-1',
      expectedQty: 10,
      receivedQty: 8,
      damagedQty: 2,
    };
    expect(shortOf(l)).toBe(0);
    expect(affectedLines([l])).toHaveLength(1);
  });

  it('the India leg of a VIA_BD consignment is a loss in OUR hands, and says so', () => {
    const msg = receiptShortfallOpeningMessage({
      ...GR_2026_08_0004,
      receiptNumber: 'CN-2026-08-000003-000003',
      warehouse: { code: 'BLR-01', name: 'Bangalore', timezone: 'Asia/Kolkata' },
      originWarehouse: { code: 'DAC-01', name: 'Dhaka Intake', timezone: 'Asia/Dhaka' },
      leg: 'IN_TRANSIT',
      lines: [
        {
          productName: 'Aviator OG Sunglass',
          variantLabel: null,
          skuCode: 'AVIATO-GREE-BLAC',
          expectedQty: 198,
          receivedQty: 195,
          damagedQty: 1,
        },
      ],
      ticketNumber: 'TK-2026-000009',
    });
    expect(msg).toContain('sent 198 · counted 195 · damaged 1 · short 2');
    expect(msg).toContain('between DAC-01 (Dhaka Intake) and BLR-01 (Bangalore)');
    expect(msg).toContain('so they were in our hands');
    expect(msg).toContain('Arrived damaged: 1 unit.');
    expect(msg).not.toContain('between you and our first warehouse');
    // Never a figure: nobody has decided one.
    expect(msg).not.toMatch(/₹\s?\d/);
  });

  it('a receipt with only damage names the damage and not a missing leg', () => {
    const msg = receiptShortfallOpeningMessage({
      ...GR_2026_08_0004,
      lines: [
        {
          productName: 'Mug',
          variantLabel: null,
          skuCode: 'MUG-1',
          expectedQty: 5,
          receivedQty: 4,
          damagedQty: 1,
        },
      ],
      ticketNumber: null,
    });
    expect(msg.startsWith('We opened this ticket for you because goods receipt')).toBe(true);
    expect(msg).toContain('Arrived damaged: 1 unit.');
    expect(msg).not.toContain('went missing');
  });

  it('dates the count in the warehouse’s own zone, and survives a bad zone name', () => {
    // 20:30 UTC on the 18th is already the 19th in Dhaka.
    expect(formatCountDate(new Date('2026-08-18T20:30:00Z'), 'Asia/Dhaka')).toBe('19 Aug 2026');
    expect(formatCountDate(new Date('2026-09-02T10:00:00Z'), 'Not/AZone')).toBe('2 Sep 2026');
  });
});
