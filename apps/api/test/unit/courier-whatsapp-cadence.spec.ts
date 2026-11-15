import {
  COLD_MS,
  HOT_BASE_MS,
  nextCadence,
  type CadenceState,
} from '../../src/modules/courier-whatsapp/cadence';

const T0 = new Date('2026-11-15T10:00:00Z');
const at = (ms: number): Date => new Date(T0.getTime() + ms);
const min = 60_000;
const cold: CadenceState = { gapMs: null, lastNewAt: null };

describe('nextCadence', () => {
  it('new messages from cold: next read in 5 minutes', () => {
    const n = nextCadence({ now: T0, prev: cold, foundNew: true });
    expect(n.gapMs).toBe(HOT_BASE_MS);
    expect(n.nextReadAt.getTime() - T0.getTime()).toBe(5 * min);
    expect(n.hot).toBe(true);
  });

  it('keeps finding new: 5, 10, 20, 40', () => {
    let state: CadenceState = cold;
    let now = T0;
    const gaps: number[] = [];
    for (let i = 0; i < 4; i += 1) {
      const n = nextCadence({ now, prev: state, foundNew: true });
      gaps.push((n.gapMs ?? 0) / min);
      state = n;
      now = n.nextReadAt;
    }
    expect(gaps).toEqual([5, 10, 20, 40]);
  });

  it('nothing new doubles the gap', () => {
    const hot = nextCadence({ now: T0, prev: cold, foundNew: true });
    const n = nextCadence({ now: at(5 * min), prev: hot, foundNew: false });
    expect(n.gapMs).toBe(10 * min);
  });

  it('a customer reply resets to 5 minutes', () => {
    const prev: CadenceState = { gapMs: 40 * min, lastNewAt: T0 };
    const n = nextCadence({ now: at(50 * min), prev, foundNew: true, replied: true });
    expect(n.gapMs).toBe(5 * min);
  });

  it('the hot window ends 3 hours after the last new message: back to cold 6 h', () => {
    const prev: CadenceState = { gapMs: 80 * min, lastNewAt: T0 };
    const now = at(3 * 60 * min + 1);
    const n = nextCadence({ now, prev, foundNew: false });
    expect(n.hot).toBe(false);
    expect(n.gapMs).toBeNull();
    expect(n.nextReadAt.getTime() - now.getTime()).toBe(COLD_MS);
  });

  it('a gap reaching 6 hours falls back to the normal debounce', () => {
    const prev: CadenceState = { gapMs: 200 * min, lastNewAt: at(-60 * min) };
    const n = nextCadence({ now: T0, prev, foundNew: false });
    expect(n.hot).toBe(false);
    expect(n.nextReadAt.getTime() - T0.getTime()).toBe(COLD_MS);
  });

  it('a cold parcel with nothing new stays cold', () => {
    const n = nextCadence({ now: T0, prev: cold, foundNew: false });
    expect(n.hot).toBe(false);
    expect(n.nextReadAt.getTime() - T0.getTime()).toBe(COLD_MS);
  });
});
