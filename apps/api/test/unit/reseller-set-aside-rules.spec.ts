import {
  allowanceForLine,
  confirmAllowance,
  unusedOf,
} from '../../src/modules/reseller-order-gate/reseller-set-aside-rules';

/**
 * RS-5 — the confirm-time set-aside arithmetic (pure). What an order line
 * may be RESERVED at confirmation, given the seller's reseller stores'
 * set-asides. INV-3's figure comes in as `realAvailable`; this can only
 * ever allow less, never more.
 */
describe('RS-5 confirm-time set-aside rules', () => {
  describe('confirmAllowance', () => {
    it('SET_ASIDE: min(own unused, real available)', () => {
      expect(
        confirmAllowance({
          kind: 'SET_ASIDE',
          realAvailable: 10,
          ownUnusedSetAside: 4,
          othersUnusedSetAside: 99,
        }),
      ).toBe(4);
      expect(
        confirmAllowance({
          kind: 'SET_ASIDE',
          realAvailable: 3,
          ownUnusedSetAside: 4,
          othersUnusedSetAside: 0,
        }),
      ).toBe(3);
    });

    it('SHARED and CHANNEL: real available less the others’ unused set-asides, never below 0', () => {
      for (const kind of ['SHARED', 'CHANNEL'] as const) {
        expect(
          confirmAllowance({
            kind,
            realAvailable: 10,
            ownUnusedSetAside: 0,
            othersUnusedSetAside: 6,
          }),
        ).toBe(4);
        expect(
          confirmAllowance({
            kind,
            realAvailable: 5,
            ownUnusedSetAside: 0,
            othersUnusedSetAside: 9,
          }),
        ).toBe(0);
      }
    });

    it('treats garbage as zero rather than inventing stock', () => {
      expect(
        confirmAllowance({
          kind: 'SHARED',
          realAvailable: Number.NaN,
          ownUnusedSetAside: 0,
          othersUnusedSetAside: 0,
        }),
      ).toBe(0);
      expect(
        confirmAllowance({
          kind: 'SET_ASIDE',
          realAvailable: 10,
          ownUnusedSetAside: -3,
          othersUnusedSetAside: 0,
        }),
      ).toBe(0);
    });
  });

  describe('unusedOf', () => {
    it('is the set-aside less what the store has consumed, floored at 0', () => {
      expect(unusedOf({ storeId: 'a', setAsideQty: 5, consumed: 2 })).toBe(3);
      expect(unusedOf({ storeId: 'a', setAsideQty: 5, consumed: 9 })).toBe(0);
    });
  });

  describe('allowanceForLine', () => {
    const commitments = [
      { storeId: 'store-a', setAsideQty: 5, consumed: 2 }, // 3 unused
      { storeId: 'store-b', setAsideQty: 4, consumed: 0 }, // 4 unused
    ];

    it('a CHANNEL order may not eat any store’s unused set-aside (the RS-5 behaviour change)', () => {
      // 20 real available (store-a's 2 consumed are already out of it);
      // 3 + 4 unused are protected.
      expect(allowanceForLine({ orderStoreId: null, realAvailable: 20, commitments })).toEqual({
        kind: 'CHANNEL',
        allowance: 13,
      });
    });

    it('a CHANNEL order with no set-asides anywhere gets everything that is really there', () => {
      expect(allowanceForLine({ orderStoreId: null, realAvailable: 7, commitments: [] })).toEqual({
        kind: 'CHANNEL',
        allowance: 7,
      });
    });

    it('a SHARED store (no set-aside of its own) is kept off the OTHER stores’ set-asides', () => {
      expect(allowanceForLine({ orderStoreId: 'store-c', realAvailable: 20, commitments })).toEqual(
        { kind: 'SHARED', allowance: 13 },
      );
    });

    it('a SET_ASIDE store may use its own unused set-aside, capped by what is really there', () => {
      expect(allowanceForLine({ orderStoreId: 'store-a', realAvailable: 20, commitments })).toEqual(
        { kind: 'SET_ASIDE', allowance: 3 },
      );
      expect(allowanceForLine({ orderStoreId: 'store-b', realAvailable: 2, commitments })).toEqual({
        kind: 'SET_ASIDE',
        allowance: 2,
      });
    });

    it('a store’s set-aside is protected exactly once: consumed units leave it, not twice', () => {
      // store-a consumed 2 of 5. Its consumed units are reservations, so
      // they are already out of realAvailable; only its 3 UNUSED are
      // subtracted again for a channel order. Protected in total: 2 + 3 = 5.
      const a = [{ storeId: 'store-a', setAsideQty: 5, consumed: 2 }];
      expect(allowanceForLine({ orderStoreId: null, realAvailable: 8, commitments: a })).toEqual({
        kind: 'CHANNEL',
        allowance: 5,
      });
    });
  });
});
