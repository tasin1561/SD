import { describe, expect, it } from 'vitest';
import { courierLabel } from '@skydrop/ui/status';

/**
 * A manually-placed parcel's `courierCode` is the literal 'manual'
 * (CUR-8). Showing that string told the seller — and, on the public
 * tracking page, the customer — that their parcel was with a courier
 * called "manual". `courierLabel` is the one place that decides what to
 * show, so the four screens reading it cannot drift apart.
 */
describe('courierLabel', () => {
  it('prefers the real carrier over the placeholder code', () => {
    expect(courierLabel('manual', 'Bluedart')).toBe('Bluedart');
  });

  it('falls back to the code when there is no manual name', () => {
    // Every integrated shipment: the code IS the carrier.
    expect(courierLabel('delhivery', null)).toBe('delhivery');
    expect(courierLabel('shiprocket', undefined)).toBe('shiprocket');
  });

  it('treats a blank or whitespace-only name as absent', () => {
    // An empty label is worse than an honest ugly one — a row with
    // nothing where the carrier goes reads as a broken screen.
    expect(courierLabel('manual', '')).toBe('manual');
    expect(courierLabel('manual', '   ')).toBe('manual');
  });

  it('trims a name typed with stray spaces', () => {
    expect(courierLabel('manual', '  DTDC ')).toBe('DTDC');
  });

  it('never renders empty, even with nothing to go on', () => {
    expect(courierLabel(null, null)).toBe('—');
    expect(courierLabel(undefined, undefined)).toBe('—');
  });
});
