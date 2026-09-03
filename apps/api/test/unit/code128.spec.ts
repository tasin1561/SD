import {
  code128Modules,
  encodeCode128B,
  isEncodableCode128B,
} from '../../src/modules/warehouse-printing/services/code128';

/**
 * Verified against the published Code 128 specification rather than
 * against itself. A barcode that scans as a DIFFERENT number than the
 * one printed beside it sends the parcel to the wrong place while the
 * label agrees with itself, so the encoding is checked at the level of
 * actual bar widths.
 */
describe('Code 128 subset B', () => {
  it('starts with the subset-B start symbol and ends with stop', () => {
    const w = encodeCode128B('A');
    // Start B = 104 → pattern 211214 (211412 is Start A — a mistake
    // worth leaving recorded, since the two differ by one digit and a
    // scanner reading the wrong subset returns different characters).
    // Stop = 106 → 2331112.
    expect(w.slice(0, 6)).toEqual([2, 1, 1, 2, 1, 4]);
    expect(w.slice(-7)).toEqual([2, 3, 3, 1, 1, 1, 2]);
  });

  it('computes the mod-103 checksum the spec describes', () => {
    // "AB": start 104, 'A'=33 at position 1, 'B'=34 at position 2.
    // (104 + 33*1 + 34*2) = 205; 205 mod 103 = 102 → pattern 411131.
    const w = encodeCode128B('AB');
    const check = w.slice(-13, -7);
    expect(check).toEqual([4, 1, 1, 1, 3, 1]);
  });

  it('encodes a real AWB', () => {
    // The manual waybill from SD-2026-26-000003.
    const w = encodeCode128B('15610994');
    // start + 8 data + checksum = 10 symbols of 11 modules, plus a
    // 13-module stop.
    expect(w).toHaveLength(10 * 6 + 7);
    expect(code128Modules('15610994')).toBe(10 * 11 + 13);
  });

  it('every symbol except stop is 11 modules wide', () => {
    const w = encodeCode128B('SKYDROP-123');
    const body = w.slice(0, -7);
    for (let i = 0; i < body.length; i += 6) {
      const sum = body.slice(i, i + 6).reduce((n, x) => n + x, 0);
      expect(sum).toBe(11);
    }
  });

  it('refuses a character it cannot carry rather than dropping it', () => {
    // Silently skipping a character would print a barcode that scans as
    // a different waybill than the digits underneath it.
    expect(isEncodableCode128B('AWB-123')).toBe(true);
    expect(isEncodableCode128B('AWBé')).toBe(false);
    expect(() => encodeCode128B('AWBé')).toThrow(/CODE128_UNENCODABLE/);
  });
});
