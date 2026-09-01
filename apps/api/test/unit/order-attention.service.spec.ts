import { OrderAttentionService } from '../../src/modules/order-attention/services/order-attention.service';

/**
 * NSA day counting.
 *
 * The arithmetic is the whole feature: get it wrong and either nobody is
 * told about a stuck parcel, or everybody is told about a healthy one at
 * six every evening until it delivers.
 *
 * All times below are written as UTC instants with their India-time
 * meaning in the comment, because that is the timezone the cutoff is an
 * hour of — the servers are not in it and neither is the seller.
 */
const evenings = OrderAttentionService.evenings;
const CUTOFF = 18; // 6pm IST

describe('OrderAttentionService.evenings', () => {
  it('is zero before the first cutoff has passed', () => {
    // Out at 10:00 IST, asked at 17:00 IST the same day. The van is
    // still out; nothing is wrong yet.
    const out = new Date('2026-09-01T04:30:00Z'); // 10:00 IST
    const now = new Date('2026-09-01T11:30:00Z'); // 17:00 IST
    expect(evenings(out, now, CUTOFF)).toBe(0);
  });

  it('is one at the cutoff on the day it went out', () => {
    const out = new Date('2026-09-01T04:30:00Z'); // 10:00 IST
    const now = new Date('2026-09-01T12:30:00Z'); // 18:00 IST exactly
    expect(evenings(out, now, CUTOFF)).toBe(1);
  });

  it('reaches two and three on the following evenings', () => {
    const out = new Date('2026-09-01T04:30:00Z'); // 10:00 IST, 1 Sep
    expect(evenings(out, new Date('2026-09-02T13:00:00Z'), CUTOFF)).toBe(2); // 18:30 IST, 2 Sep
    expect(evenings(out, new Date('2026-09-03T13:00:00Z'), CUTOFF)).toBe(3); // 18:30 IST, 3 Sep
  });

  it('does not tick over at midnight — the next DAY still waits for its cutoff', () => {
    // The trap: counting elapsed hours would make a parcel that went out
    // at 23:00 "day 2" seven hours later, at 6am, with nobody having had
    // a chance to deliver it.
    const out = new Date('2026-09-01T17:30:00Z'); // 23:00 IST, 1 Sep
    expect(evenings(out, new Date('2026-09-02T04:30:00Z'), CUTOFF)).toBe(1); // 10:00 IST, 2 Sep
    expect(evenings(out, new Date('2026-09-02T13:00:00Z'), CUTOFF)).toBe(2); // 18:30 IST, 2 Sep
  });

  it('counts in INDIA time, not the server’s', () => {
    // 19:00 UTC on 1 Sep is already 00:30 IST on 2 Sep. A server reading
    // its own clock would call this the first evening; in Delhi it is
    // the small hours of the next day and the cutoff has passed once.
    const out = new Date('2026-09-01T04:30:00Z'); // 10:00 IST, 1 Sep
    const now = new Date('2026-09-01T19:00:00Z'); // 00:30 IST, 2 Sep
    expect(evenings(out, now, CUTOFF)).toBe(1);
  });

  it('never goes negative for a scan dated in the future', () => {
    // Courier clocks drift and scans arrive with their own timestamps.
    const out = new Date('2026-09-05T04:30:00Z');
    const now = new Date('2026-09-01T13:00:00Z');
    expect(evenings(out, now, CUTOFF)).toBe(0);
  });

  it('honours a different cutoff hour', () => {
    const out = new Date('2026-09-01T04:30:00Z'); // 10:00 IST
    const now = new Date('2026-09-01T10:00:00Z'); // 15:30 IST
    expect(evenings(out, now, 18)).toBe(0);
    expect(evenings(out, now, 15)).toBe(1);
  });
});

describe('OrderAttentionService.dayPhrase', () => {
  // Reached through the notification variables; the phrase is what the
  // seller actually reads in the subject line.
  const phrase = (OrderAttentionService as unknown as { dayPhrase: (d: number) => string })
    .dayPhrase;

  it('says it the way a person would', () => {
    expect(phrase(1)).toBe('since yesterday');
    expect(phrase(2)).toBe('for 2 days now');
    expect(phrase(3)).toBe('for 3 days now');
  });
});
