import { RtoDisposition, RtoItemCondition } from '@skydrop/db';
import {
  type ScrapTicketFacts,
  scrapTicketOpeningMessage,
  scrapTicketReinspectionNote,
} from '../../src/modules/warehouse-rto/services/rto-scrap-ticket-message';

/**
 * WMS-8d — the scrap ticket on a line inspected BY QUANTITY.
 *
 * The owner's case: two came back, one damaged and one fine. The seller
 * must read how many were damaged and what happens to THOSE units, not
 * one verdict for the pair.
 */
const BASE: ScrapTicketFacts = {
  productName: 'Aviator OG Sunglass',
  skuCode: 'AVIATO-GREE-BLAC',
  quantity: 2,
  condition: RtoItemCondition.DAMAGED,
  disposition: RtoDisposition.RESTOCK,
  orderNumber: 'SD-2026-37-000001',
  shipmentNumber: 'SH-2026-37-000001',
  awbNumber: '38061110000001',
  receivedAt: new Date('2026-09-13T06:00:00.000Z'),
  receivedWarehouse: { code: 'CCU-01', name: 'Kolkata Main', timezone: 'Asia/Kolkata' },
  notes: null,
};

describe('scrap ticket message — a split line', () => {
  it('1 damaged kept aside + 1 good restocked, each said with its quantity', () => {
    const msg = scrapTicketOpeningMessage({
      ...BASE,
      ticketNumber: 'TK-2026-000020',
      rows: [
        {
          quantity: 1,
          condition: RtoItemCondition.DAMAGED,
          disposition: RtoDisposition.HOLD_DAMAGED,
          notes: null,
        },
        {
          quantity: 1,
          condition: RtoItemCondition.GOOD,
          disposition: RtoDisposition.RESTOCK,
          notes: null,
        },
      ],
    });
    expect(msg).toBe(
      [
        'Ticket TK-2026-000020 — we opened this for you after inspecting a returned parcel.',
        '',
        'Aviator OG Sunglass (AVIATO-GREE-BLAC), quantity 2 — we checked each unit:',
        '• 1 of 2 arrived damaged: we are keeping it aside for you in our damaged-goods area, ' +
          'out of your sellable stock, until you tell us here whether to send it back to you or dispose of it.',
        '• 1 of 2 is in good condition: we are putting it back into your sellable stock.',
        'Order SD-2026-37-000001 · parcel SH-2026-37-000001 · waybill 38061110000001',
        'Received back on 13 Sep 2026 at CCU-01 (Kolkata Main).',
        '',
        'What happens next: we review the damage and reply here. ' +
          'If a refund is due, it is credited to your wallet and shown on this ticket. ' +
          'If you have anything that helps — how the product is normally packaged, or a photo of it new — reply below.',
      ].join('\n'),
    );
  });

  it('uses "them" for a group of more than one, and says a missing group was missing', () => {
    const msg = scrapTicketOpeningMessage({
      ...BASE,
      quantity: 3,
      condition: RtoItemCondition.MISSING,
      ticketNumber: null,
      rows: [
        {
          quantity: 2,
          condition: RtoItemCondition.DAMAGED,
          disposition: RtoDisposition.WRITE_OFF,
          notes: 'shattered',
        },
        {
          quantity: 1,
          condition: RtoItemCondition.MISSING,
          disposition: RtoDisposition.WRITE_OFF,
          notes: null,
        },
      ],
    });
    expect(msg).toContain(
      `• 2 of 3 arrived damaged: we are writing them off — not going back into your sellable stock. Inspector's note: "shattered"`,
    );
    expect(msg).toContain('• 1 of 3 was missing from the returned parcel: we are writing it off');
  });

  it('rows that all say the same thing read exactly as an unsplit line', () => {
    const same = {
      quantity: 1,
      condition: RtoItemCondition.DAMAGED,
      disposition: RtoDisposition.WRITE_OFF,
      notes: null,
    };
    const unsplit = scrapTicketOpeningMessage({
      ...BASE,
      disposition: RtoDisposition.WRITE_OFF,
      ticketNumber: 'TK-1',
    });
    const merged = scrapTicketOpeningMessage({
      ...BASE,
      ticketNumber: 'TK-1',
      rows: [same, same],
    });
    expect(merged).toBe(unsplit);
    expect(merged).toContain('quantity 2: arrived damaged.');
  });

  it('an unsplit Keep aside (damaged) line says the unit stays with us, out of sellable stock', () => {
    const msg = scrapTicketOpeningMessage({
      ...BASE,
      quantity: 1,
      disposition: RtoDisposition.HOLD_DAMAGED,
      ticketNumber: null,
    });
    expect(msg).toContain(
      'What we are doing with it: keeping it aside for you in our damaged-goods area — it stays out of your sellable stock ' +
        'until you tell us here whether to send it back to you or dispose of it.',
    );
  });

  it('a re-inspection that changes the split restates the new split', () => {
    const note = scrapTicketReinspectionNote({
      ...BASE,
      rows: [
        {
          quantity: 1,
          condition: RtoItemCondition.DAMAGED,
          disposition: RtoDisposition.HOLD_DAMAGED,
          notes: null,
        },
        {
          quantity: 1,
          condition: RtoItemCondition.GOOD,
          disposition: RtoDisposition.RESTOCK,
          notes: null,
        },
      ],
    });
    expect(note.startsWith('We inspected this item again and updated what we found.')).toBe(true);
    expect(note).toContain('• 1 of 2 arrived damaged');
    expect(note).toContain('• 1 of 2 is in good condition');
  });
});
