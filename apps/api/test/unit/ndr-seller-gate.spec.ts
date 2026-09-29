import {
  KNOWN_NDR_ACTIONS,
  NARROW_TO_NOTHING,
  NO_NARROWING,
  narrowNdrGate,
  parseNdrActions,
  type NdrGate,
} from '../../src/modules/courier-ndr-runner/services/ndr-gate';
import { NdrSettingsService } from '../../src/modules/courier-ndr-runner/services/ndr-settings.service';
import { JSON_VALUED_ENUM_LIST_KEYS } from '../../src/modules/settings/services/settings-resolver.service';

/**
 * The per-seller NDR switches, and the one rule that makes them safe.
 *
 * Everything here is about a per-seller setting NOT being able to send a
 * van. `narrowNdrGate` is the only place the global pair and a seller's
 * pair are combined, and the whole point of it being a function rather
 * than two lines of `??` at a call site is that the rule can be pinned.
 */

const BOTH: NdrGate = { enabled: true, autoActions: [...KNOWN_NDR_ACTIONS] };

describe('narrowNdrGate — a seller override NARROWS, and can never widen', () => {
  it('a seller saying TRUE against a global FALSE still fires nothing', () => {
    // The load-bearing case. An operator's global "no" is what CUR-10's
    // amendment rests on; a seller row must not be able to undo it.
    const out = narrowNdrGate(
      { enabled: false, autoActions: ['RE-ATTEMPT'] },
      { enabled: true, autoActions: ['RE-ATTEMPT'] },
    );
    expect(out.enabled).toBe(false);
  });

  it('a seller saying FALSE against a global TRUE fires nothing for THEM', () => {
    const out = narrowNdrGate(BOTH, { enabled: false, autoActions: null });
    expect(out.enabled).toBe(false);
    // The global is untouched — narrowing is per seller, not a mutation.
    expect(BOTH.enabled).toBe(true);
  });

  it('a seller saying nothing inherits the global, unchanged', () => {
    expect(narrowNdrGate(BOTH, NO_NARROWING)).toEqual(BOTH);
  });

  it('an action the seller names but the global does not is DROPPED', () => {
    // Union rather than intersection would send a PICKUP_RESCHEDULE the
    // global list has never permitted — an action nobody signed off.
    const out = narrowNdrGate(
      { enabled: true, autoActions: ['RE-ATTEMPT'] },
      { enabled: null, autoActions: ['RE-ATTEMPT', 'PICKUP_RESCHEDULE'] },
    );
    expect(out.autoActions).toEqual(['RE-ATTEMPT']);
  });

  it('a seller list is INTERSECTED, not substituted', () => {
    const out = narrowNdrGate(BOTH, { enabled: null, autoActions: ['PICKUP_RESCHEDULE'] });
    expect(out.autoActions).toEqual(['PICKUP_RESCHEDULE']);
  });

  it('an EMPTY seller list means nothing, and is distinct from no list at all', () => {
    // `[]` is a decision ("none of them"); `null` is an absence ("no
    // opinion"). Collapsing the two would make opting out impossible.
    expect(narrowNdrGate(BOTH, { enabled: null, autoActions: [] }).autoActions).toEqual([]);
    expect(narrowNdrGate(BOTH, { enabled: null, autoActions: null }).autoActions).toEqual([
      ...KNOWN_NDR_ACTIONS,
    ]);
  });

  it('the fail-closed narrowing yields nothing, whatever the global permits', () => {
    expect(narrowNdrGate(BOTH, NARROW_TO_NOTHING)).toEqual({ enabled: false, autoActions: [] });
  });

  it('no combination of inputs can produce more than the global permits', () => {
    // Exhaustive over the small space, because "it narrows" is a claim
    // about EVERY input, not about the examples above.
    const sellerLists: (readonly string[] | null)[] = [
      null,
      [],
      ['RE-ATTEMPT'],
      ['PICKUP_RESCHEDULE'],
      ['RE-ATTEMPT', 'PICKUP_RESCHEDULE'],
    ];
    for (const gEnabled of [true, false]) {
      for (const gList of sellerLists.filter((l) => l !== null)) {
        for (const sEnabled of [true, false, null]) {
          for (const sList of sellerLists) {
            const global = { enabled: gEnabled, autoActions: gList } as NdrGate;
            const out = narrowNdrGate(global, {
              enabled: sEnabled,
              autoActions: sList as never,
            });
            expect(out.enabled === true && global.enabled === false).toBe(false);
            for (const a of out.autoActions) expect(global.autoActions).toContain(a);
          }
        }
      }
    }
  });
});

describe('parseNdrActions — an unrecognised entry is dropped, never trusted', () => {
  it('keeps only the courier vocabulary', () => {
    expect(parseNdrActions(['RE-ATTEMPT', 'RE_ATTEMPT', 'nonsense', 7, null])).toEqual([
      'RE-ATTEMPT',
    ]);
  });

  it('a non-array is an empty list, not a crash', () => {
    expect(parseNdrActions('RE-ATTEMPT')).toEqual([]);
    expect(parseNdrActions(null)).toEqual([]);
    expect(parseNdrActions({ 'RE-ATTEMPT': true })).toEqual([]);
  });
});

/**
 * SET-1's writer and the runner must agree on what a valid entry is.
 *
 * The resolver cannot import the runner's list — it is dependency-free
 * by design so any domain can import it without a cycle — so the values
 * are restated there. A test CAN import both (the M10 F6 technique), and
 * drift here is the shape where the admin form accepts a word the runner
 * then silently discards.
 */
describe('the allow-list vocabulary is the same on both sides', () => {
  it('SET-1 refuses exactly what the runner recognises', () => {
    const fromResolver = JSON_VALUED_ENUM_LIST_KEYS['courier.ndr_auto_categories'];
    expect([...(fromResolver ?? [])].sort()).toEqual([...KNOWN_NDR_ACTIONS].sort());
  });
});

/**
 * The read side: the resolver's ordinary `sellerOverride ?? default`
 * answer must NOT be what reaches the gate.
 */
describe('NdrSettingsService.gateForSeller', () => {
  function make(resolve: jest.Mock): NdrSettingsService {
    return new NdrSettingsService({ client: {} } as never, { resolve } as never);
  }

  it('ignores a resolved value that came from the SYSTEM DEFAULT', async () => {
    // `resolve()` falls back to the global when the seller set nothing.
    // Treating that as the seller's opinion would make the narrowing a
    // no-op that looked like it worked.
    const resolve = jest
      .fn()
      .mockResolvedValue({ value: true, source: 'SYSTEM_DEFAULT', key: 'k', valueType: 'BOOLEAN' });
    const out = await make(resolve).gateForSeller('seller-1', {
      enabled: false,
      autoActions: [],
    });
    expect(out).toEqual({ enabled: false, autoActions: [] });
  });

  it('a seller override of TRUE cannot open a globally-closed gate', async () => {
    const resolve = jest.fn().mockImplementation((_s: string, key: string) =>
      Promise.resolve({
        key,
        valueType: key.endsWith('enabled') ? 'BOOLEAN' : 'JSON',
        value: key.endsWith('enabled') ? true : ['RE-ATTEMPT', 'PICKUP_RESCHEDULE'],
        source: 'SELLER_OVERRIDE',
      }),
    );
    const out = await make(resolve).gateForSeller('seller-1', {
      enabled: false,
      autoActions: ['RE-ATTEMPT'],
    });
    expect(out).toEqual({ enabled: false, autoActions: ['RE-ATTEMPT'] });
  });

  it('a seller override of FALSE closes a globally-open gate', async () => {
    const resolve = jest.fn().mockImplementation((_s: string, key: string) =>
      Promise.resolve({
        key,
        valueType: key.endsWith('enabled') ? 'BOOLEAN' : 'JSON',
        value: key.endsWith('enabled') ? false : ['RE-ATTEMPT'],
        source: 'SELLER_OVERRIDE',
      }),
    );
    const out = await make(resolve).gateForSeller('seller-1', BOTH);
    expect(out).toEqual({ enabled: false, autoActions: ['RE-ATTEMPT'] });
  });

  it('FAILS CLOSED when the settings read throws', async () => {
    // Not firing a van we meant to costs a day; firing one we did not
    // costs money and a customer's afternoon. The asymmetry is the rule.
    const resolve = jest.fn().mockRejectedValue(new Error('settings unavailable'));
    const out = await make(resolve).gateForSeller('seller-1', BOTH);
    expect(out).toEqual({ enabled: false, autoActions: [] });
  });

  it('FAILS CLOSED on a stored override holding something that is not true', async () => {
    const resolve = jest.fn().mockImplementation((_s: string, key: string) =>
      Promise.resolve({
        key,
        valueType: key.endsWith('enabled') ? 'BOOLEAN' : 'JSON',
        value: key.endsWith('enabled') ? 'yes' : ['RE_ATTEMPT'],
        source: 'SELLER_OVERRIDE',
      }),
    );
    const out = await make(resolve).gateForSeller('seller-1', BOTH);
    expect(out).toEqual({ enabled: false, autoActions: [] });
  });
});
