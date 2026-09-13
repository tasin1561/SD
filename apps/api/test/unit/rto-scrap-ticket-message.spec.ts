import { RtoDisposition, RtoItemCondition } from '@skydrop/db';
import {
  formatReceivedDate,
  type ScrapTicketFacts,
  scrapTicketOpeningMessage,
  scrapTicketReinspectionNote,
} from '../../src/modules/warehouse-rto/services/rto-scrap-ticket-message';

/**
 * The message a seller reads first on a scrap/damage ticket WE opened.
 *
 * It used to be the inspector's notes and nothing else, so a ticket
 * inspected without notes read "Nothing said yet." to the seller whose
 * goods it was about. These pin that the facts are always there, and that
 * the wording matches the one-off backfill migration for the production
 * ticket (SD-TEST-524086) — the first case below IS that ticket.
 */
const PRODUCTION: ScrapTicketFacts = {
  productName: 'Aviator OG Sunglass',
  skuCode: 'AVIATO-GREE-BLAC',
  quantity: 1,
  condition: RtoItemCondition.DAMAGED,
  disposition: RtoDisposition.WRITE_OFF,
  orderNumber: 'SD-TEST-524086',
  shipmentNumber: 'SH-TEST-524086',
  awbNumber: '38061110524086',
  // 18:12 UTC on the 9th is 23:42 IST — still the 9th where the goods are.
  receivedAt: new Date('2026-09-09T18:12:40.920Z'),
  receivedWarehouse: { code: 'CCU-01', name: 'Kolkata Main', timezone: 'Asia/Kolkata' },
  notes: null,
};

describe('scrapTicketOpeningMessage', () => {
  it('states every fact for a damaged line with no inspector notes (the production ticket)', () => {
    expect(scrapTicketOpeningMessage({ ...PRODUCTION, ticketNumber: 'TK-2026-000003' })).toBe(
      [
        'Ticket TK-2026-000003 — we opened this for you after inspecting a returned parcel.',
        '',
        'Aviator OG Sunglass (AVIATO-GREE-BLAC), quantity 1: arrived damaged.',
        'Order SD-TEST-524086 · parcel SH-TEST-524086 · waybill 38061110524086',
        'Received back on 9 Sep 2026 at CCU-01 (Kolkata Main).',
        'What we are doing with it: writing it off — it will not go back into your sellable stock.',
        '',
        'What happens next: we review the damage and reply here. If a refund is due, it is credited to your wallet and shown on this ticket. If you have anything that helps — how the product is normally packaged, or a photo of it new — reply below.',
      ].join('\n'),
    );
  });

  it('says a MISSING line was missing, and what we do about that', () => {
    const msg = scrapTicketOpeningMessage({
      ...PRODUCTION,
      ticketNumber: 'TK-2026-000009',
      condition: RtoItemCondition.MISSING,
      quantity: 2,
    });
    expect(msg).toContain('quantity 2: was missing from the returned parcel.');
    expect(msg).toContain('What happens next: we look into what happened to it and reply here.');
    expect(msg).not.toContain('arrived damaged');
  });

  it("quotes the inspector's notes, trimmed, when there are any", () => {
    const msg = scrapTicketOpeningMessage({
      ...PRODUCTION,
      ticketNumber: 'TK-2026-000004',
      notes: '  lens cracked, frame bent \n',
    });
    expect(msg).toContain(`Inspector's note: "lens cracked, frame bent"`);
  });

  it('leaves the note line out for blank notes rather than printing an empty quote', () => {
    const msg = scrapTicketOpeningMessage({ ...PRODUCTION, ticketNumber: 'T', notes: '   ' });
    expect(msg).not.toContain("Inspector's note");
  });

  it('drops the warehouse, but keeps the date, when the warehouse is unknown', () => {
    const msg = scrapTicketOpeningMessage({
      ...PRODUCTION,
      ticketNumber: 'TK-2026-000005',
      receivedWarehouse: null,
    });
    expect(msg).toContain('Received back on 9 Sep 2026.');
    expect(msg).not.toContain(' at CCU-01');
  });

  it('drops the whole received line when it has not been received, and blanks any missing reference', () => {
    const msg = scrapTicketOpeningMessage({
      ...PRODUCTION,
      ticketNumber: 'TK-2026-000006',
      receivedAt: null,
      awbNumber: null,
    });
    expect(msg).not.toContain('Received back');
    expect(msg).toContain('Order SD-TEST-524086 · parcel SH-TEST-524086\n');
  });

  it('says what happens to the unit for each disposition', () => {
    const say = (disposition: RtoDisposition): string =>
      scrapTicketOpeningMessage({ ...PRODUCTION, ticketNumber: 'T', disposition });
    expect(say(RtoDisposition.RESTOCK)).toContain('putting it back into your sellable stock.');
    expect(say(RtoDisposition.INSPECT_LATER)).toContain('holding it aside for a closer look');
  });

  it('never names a refund figure — none is known when the ticket opens', () => {
    expect(scrapTicketOpeningMessage({ ...PRODUCTION, ticketNumber: 'T' })).not.toMatch(
      /₹|\bINR\b/,
    );
  });
});

describe('scrapTicketReinspectionNote', () => {
  it('states the corrected finding', () => {
    const note = scrapTicketReinspectionNote({
      ...PRODUCTION,
      condition: RtoItemCondition.MISSING,
      notes: 'second look: box was empty',
    });
    expect(note.startsWith('We inspected this item again and updated what we found.')).toBe(true);
    expect(note).toContain('was missing from the returned parcel.');
    expect(note).toContain(`Inspector's note: "second look: box was empty"`);
  });

  it('says so plainly when the item turns out to be fine', () => {
    const note = scrapTicketReinspectionNote({
      ...PRODUCTION,
      condition: RtoItemCondition.GOOD,
      disposition: RtoDisposition.RESTOCK,
    });
    expect(note).toContain('is in good condition after all.');
    expect(note).toContain('putting it back into your sellable stock.');
  });
});

describe('formatReceivedDate', () => {
  it('reads the date in the warehouse zone', () => {
    // 20:00 UTC on the 9th is the 10th in India.
    expect(formatReceivedDate(new Date('2026-09-09T20:00:00Z'), 'Asia/Kolkata')).toBe(
      '10 Sep 2026',
    );
  });

  it('falls back to India time on an unrecognised zone name', () => {
    expect(formatReceivedDate(new Date('2026-09-09T20:00:00Z'), 'Not/AZone')).toBe('10 Sep 2026');
  });
});
