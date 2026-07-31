import { ServiceArea } from '@skydrop/db';
import { serviceAreaFromPincode } from '../../src/modules/pricing/postal-circle';

/**
 * The prefix fallback that stops unlisted destinations pricing at ₹0.
 *
 * The North-East and J&K entries are the ones with money on them: they
 * price to zone E (₹180–1580) against REST's zone D (₹130–1160). A
 * missed prefix undercharges by up to ₹420 on a single heavy parcel; a
 * prefix claimed too widely overcharges every seller shipping there.
 * So both directions of each boundary are asserted, not just the middle.
 */
describe('serviceAreaFromPincode', () => {
  it('identifies the North-East', () => {
    for (const [pin, place] of [
      ['781001', 'Guwahati, Assam'],
      ['788001', 'Silchar, Assam'],
      ['791111', 'Itanagar, Arunachal'],
      ['795001', 'Imphal, Manipur'],
      ['796001', 'Aizawl, Mizoram'],
      ['797001', 'Kohima, Nagaland'],
      ['799001', 'Agartala, Tripura'],
      ['737101', 'Gangtok, Sikkim'],
    ] as const) {
      expect({ pin, place, area: serviceAreaFromPincode(pin) }).toEqual({
        pin,
        place,
        area: ServiceArea.SPECIAL_NE,
      });
    }
  });

  it('identifies Jammu, Kashmir and Ladakh', () => {
    for (const pin of ['180001', '181001', '190001', '192101', '194101']) {
      expect(serviceAreaFromPincode(pin)).toBe(ServiceArea.SPECIAL_JK);
    }
  });

  it('does not claim neighbours of those ranges', () => {
    // The expensive mistake in the other direction. 17xxxx is Himachal
    // and 77xxxx is West Bengal — adjacent prefixes, ordinary rates.
    // Widening 18/19 or 78/79 by one digit would silently surcharge
    // every parcel to Shimla and Siliguri.
    expect(serviceAreaFromPincode('171001')).toBe(ServiceArea.REST); // Shimla
    expect(serviceAreaFromPincode('175001')).toBe(ServiceArea.REST); // Mandi
    expect(serviceAreaFromPincode('734001')).toBe(ServiceArea.REST); // Siliguri
    expect(serviceAreaFromPincode('700001')).toBe(ServiceArea.REST); // Kolkata
    expect(serviceAreaFromPincode('770001')).toBe(ServiceArea.REST); // Odisha
  });

  it('falls back to REST for ordinary destinations', () => {
    // The four that were quoting ₹0.00 in production before this.
    for (const pin of ['250001', '486001', '831001', '623001']) {
      expect(serviceAreaFromPincode(pin)).toBe(ServiceArea.REST);
    }
  });

  it('refuses anything that is not a six-digit Indian pincode', () => {
    // Returning REST for junk would price a data-entry error instead of
    // surfacing it.
    for (const bad of ['', '12345', '1234567', 'ABCDEF', '012345', ' 78001 ', '78 0001']) {
      expect(serviceAreaFromPincode(bad)).toBeNull();
    }
  });

  it('tolerates surrounding whitespace on an otherwise valid code', () => {
    expect(serviceAreaFromPincode('  781001  ')).toBe(ServiceArea.SPECIAL_NE);
  });
});
