import {
  CONSUMED_BY_STORE_BEFORE_ORDERS,
  applyHidden,
  clampHiddenPercent,
  freeToSetAside,
  othersUnusedSetAside,
  planShrink,
  unusedSetAside,
  visibleQuantity,
} from '../../src/modules/reseller-catalogue/services/reseller-visible-stock';

/**
 * RS-3 — the one place a reseller store's visible quantity is computed.
 * Pinned by value: the seller's preview and the store's own page both
 * come through here, so a change in these numbers is a change in what
 * every store is shown.
 */
describe('reseller visible stock (RS-3)', () => {
  const shared = (over: Partial<Parameters<typeof visibleQuantity>[0]> = {}): number =>
    visibleQuantity({
      mode: 'SHARED',
      setAsideQty: null,
      hiddenPercent: 0,
      realAvailable: 100,
      othersUnusedSetAside: 0,
      consumedByStore: CONSUMED_BY_STORE_BEFORE_ORDERS,
      ...over,
    });
  const setAside = (over: Partial<Parameters<typeof visibleQuantity>[0]> = {}): number =>
    visibleQuantity({
      mode: 'SET_ASIDE',
      setAsideQty: 10,
      hiddenPercent: 0,
      realAvailable: 100,
      othersUnusedSetAside: 0,
      consumedByStore: CONSUMED_BY_STORE_BEFORE_ORDERS,
      ...over,
    });

  it('phase 2 consumes nothing of a set-aside (the phase-3 seam)', () => {
    expect(CONSUMED_BY_STORE_BEFORE_ORDERS).toBe(0);
  });

  describe('SHARED', () => {
    it('is real availability less the other stores’ unused set-asides', () => {
      expect(shared({ realAvailable: 100, othersUnusedSetAside: 30 })).toBe(70);
    });

    it('hidden 0% shows everything; hidden 90% shows a tenth, floored', () => {
      expect(shared({ realAvailable: 57, hiddenPercent: 0 })).toBe(57);
      expect(shared({ realAvailable: 57, hiddenPercent: 90 })).toBe(5); // 5.7 → 5
      expect(shared({ realAvailable: 9, hiddenPercent: 90 })).toBe(0); // 0.9 → 0
    });

    it('floors, never rounds (7 × 85% = 5.95 → 5)', () => {
      expect(shared({ realAvailable: 7, hiddenPercent: 15 })).toBe(5);
      expect(shared({ realAvailable: 3, hiddenPercent: 50 })).toBe(1);
    });

    it('over-committed set-asides elsewhere show 0, never a negative', () => {
      expect(shared({ realAvailable: 10, othersUnusedSetAside: 25 })).toBe(0);
    });

    it('a negative availability (transient over-reservation) clamps to 0', () => {
      expect(shared({ realAvailable: -4 })).toBe(0);
    });
  });

  describe('SET_ASIDE', () => {
    it('shows the unused set-aside when stock covers it', () => {
      expect(setAside({ setAsideQty: 10, realAvailable: 100 })).toBe(10);
    });

    it('never shows more than is really available', () => {
      expect(setAside({ setAsideQty: 10, realAvailable: 4 })).toBe(4);
      expect(setAside({ setAsideQty: 10, realAvailable: -2 })).toBe(0);
    });

    it('ignores the other stores (its units are its own)', () => {
      expect(setAside({ setAsideQty: 10, othersUnusedSetAside: 500 })).toBe(10);
    });

    it('applies the hidden share after the min, floored', () => {
      expect(setAside({ setAsideQty: 10, hiddenPercent: 25 })).toBe(7); // 7.5 → 7
      expect(setAside({ setAsideQty: 10, hiddenPercent: 90 })).toBe(1);
    });

    it('subtracts what the store has consumed (phase 3) and clamps at 0', () => {
      expect(setAside({ setAsideQty: 10, consumedByStore: 4 })).toBe(6);
      expect(setAside({ setAsideQty: 10, consumedByStore: 40 })).toBe(0);
    });

    it('a set-aside of 0 shows 0 whatever the stock', () => {
      expect(setAside({ setAsideQty: 0 })).toBe(0);
    });
  });

  it('clamps an out-of-range hidden percentage into 0–90', () => {
    expect(clampHiddenPercent(-5)).toBe(0);
    expect(clampHiddenPercent(95)).toBe(90);
    expect(applyHidden(100, 150)).toBe(10);
    expect(applyHidden(-3, 0)).toBe(0);
  });

  it('unused set-aside and the others’ sum', () => {
    expect(unusedSetAside(10, 3)).toBe(7);
    expect(unusedSetAside(10, -3)).toBe(10);
    expect(
      othersUnusedSetAside([
        { setAsideQty: 5, consumedByStore: 0 },
        { setAsideQty: 8, consumedByStore: 10 },
        { setAsideQty: 4, consumedByStore: 1 },
      ]),
    ).toBe(8);
  });

  it('free to set aside is on-hand less the other stores, never negative', () => {
    expect(freeToSetAside(20, 5)).toBe(15);
    expect(freeToSetAside(5, 20)).toBe(0);
  });

  describe('planShrink — newest first', () => {
    const at = (iso: string): Date => new Date(iso);
    const rows = [
      { id: 'a', setAsideQty: 5, setAsideAt: at('2026-09-01T00:00:00Z') },
      { id: 'b', setAsideQty: 4, setAsideAt: at('2026-09-05T00:00:00Z') },
      { id: 'c', setAsideQty: 3, setAsideAt: at('2026-09-10T00:00:00Z') },
    ];

    it('does nothing while the set-asides fit', () => {
      expect(planShrink(12, rows)).toEqual([]);
      expect(planShrink(40, rows)).toEqual([]);
    });

    it('cuts the newest to zero before touching an older one', () => {
      expect(planShrink(6, rows)).toEqual([
        { id: 'c', fromQty: 3, toQty: 0 },
        { id: 'b', fromQty: 4, toQty: 1 },
      ]);
    });

    it('cuts everything when nothing is on hand (or on-hand is negative)', () => {
      expect(planShrink(0, rows).map((s) => s.toQty)).toEqual([0, 0, 0]);
      expect(planShrink(-3, rows).map((s) => s.id)).toEqual(['c', 'b', 'a']);
    });

    it('breaks a timestamp tie on the later id; an undated row is the oldest', () => {
      const tied = [
        { id: '0192-a', setAsideQty: 2, setAsideAt: at('2026-09-01T00:00:00Z') },
        { id: '0192-b', setAsideQty: 2, setAsideAt: at('2026-09-01T00:00:00Z') },
        { id: '0192-z', setAsideQty: 2, setAsideAt: null },
      ];
      expect(planShrink(4, tied)).toEqual([{ id: '0192-b', fromQty: 2, toQty: 0 }]);
      expect(planShrink(1, tied).map((s) => s.id)).toEqual(['0192-b', '0192-a', '0192-z']);
    });

    it('skips zero rows and never plans a cut larger than the excess', () => {
      const withZero = [
        { id: 'z', setAsideQty: 0, setAsideAt: at('2026-09-20T00:00:00Z') },
        ...rows,
      ];
      expect(planShrink(11, withZero)).toEqual([{ id: 'c', fromQty: 3, toQty: 2 }]);
    });
  });
});
