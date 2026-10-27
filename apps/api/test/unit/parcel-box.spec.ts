import {
  parcelBox,
  type ParcelBoxItem,
} from '../../src/modules/shipment-provision/services/parcel-box';

/**
 * The box a courier is told about.
 *
 * Until 2026-10-27 nothing wrote `shipments.length/width/height`, so AWB
 * generation used its `?? 10` floor and every parcel was manifested as
 * 10×10×10 cm. These pin the replacement — including, deliberately, the
 * cases where it still declines to answer.
 */
const item = (over: Partial<ParcelBoxItem> = {}): ParcelBoxItem => ({
  quantity: 1,
  unitLengthCm: 20,
  unitWidthCm: 15,
  unitHeightCm: 5,
  ...over,
});

describe('parcelBox — the box we declare', () => {
  it('one line, one unit: the parcel IS the item', () => {
    // The common case by far, and the only one that is exact.
    expect(parcelBox([item()])).toEqual({ lengthCm: 20, widthCm: 15, heightCm: 5 });
  });

  it('stacks quantity on the height, leaving the footprint alone', () => {
    // Three shirts in one carton is 15cm tall, not three parcels and not
    // a 60cm-wide one.
    expect(parcelBox([item({ quantity: 3 })])).toEqual({
      lengthCm: 20,
      widthCm: 15,
      heightCm: 15,
    });
  });

  it('mixed lines: widest footprint, summed height', () => {
    const box = parcelBox([
      item({ unitLengthCm: 20, unitWidthCm: 15, unitHeightCm: 5 }),
      item({ unitLengthCm: 30, unitWidthCm: 10, unitHeightCm: 2, quantity: 2 }),
    ]);
    // length takes the longer item, width the wider one — they need not
    // come from the same line, because the stack is bounded by both.
    expect(box).toEqual({ lengthCm: 30, widthCm: 15, heightCm: 9 });
  });

  it('rounds UP, never down', () => {
    // A box rounded down is the under-declaration this exists to avoid.
    expect(parcelBox([item({ unitHeightCm: 2.001, quantity: 1 })])?.heightCm).toBe(2.01);
  });

  describe('it declines rather than guesses', () => {
    it('returns null when a line has no dimensions at all', () => {
      expect(
        parcelBox([item({ unitLengthCm: null, unitWidthCm: null, unitHeightCm: null })]),
      ).toBeNull();
    });

    it('returns null when ONE of three dimensions is missing', () => {
      // A partial box is not a box. Filling the gap from its siblings
      // would look authoritative and be wrong.
      expect(parcelBox([item({ unitHeightCm: null })])).toBeNull();
    });

    it('returns null when ANY line in a multi-line parcel is unknown', () => {
      expect(parcelBox([item(), item({ unitWidthCm: null })])).toBeNull();
    });

    it('rejects zero and negative dimensions instead of shipping them', () => {
      expect(parcelBox([item({ unitLengthCm: 0 })])).toBeNull();
      expect(parcelBox([item({ unitWidthCm: -4 })])).toBeNull();
    });

    it('rejects a quantity that is not a whole number above zero', () => {
      expect(parcelBox([item({ quantity: 0 })])).toBeNull();
      expect(parcelBox([item({ quantity: 1.5 })])).toBeNull();
    });

    it('returns null for no lines', () => {
      expect(parcelBox([])).toBeNull();
    });
  });

  it('null means "unknown", which is what the AWB floor already handles', () => {
    // The contract with awb-generation: a null parcel leaves the shipment
    // columns NULL and its `?? 10` takes over — today's behaviour, kept
    // deliberately for a catalogue that cannot say.
    expect(parcelBox([item({ unitLengthCm: null })])).toBeNull();
  });
});
