import { ProviderPacer } from '../../src/modules/email/services/provider-pacer';

/**
 * The pacer is what makes "per provider" true rather than nominal: the
 * queue limiter runs at the FASTEST live provider's rate, so without
 * this the slow one loses its protection entirely — and a failover
 * storm, which is exactly when everything piles onto it at once, would
 * blow its cap and mark real credential mail FAILED.
 */

/**
 * `advanceOnSleep` is the difference between modelling ONE caller and
 * modelling several at once. A real sleep moves the clock, so a
 * sequential caller's next wait is measured from when it woke — that is
 * the default. Concurrent callers all start at the SAME instant, so
 * that test freezes the clock instead; with it advancing, the second
 * caller's sleep would silently move time forward underneath the third
 * and the test would be asserting a sequence it never ran.
 */
function makePacer(opts: { advanceOnSleep?: boolean } = {}) {
  const advanceOnSleep = opts.advanceOnSleep ?? true;
  let now = 0;
  const slept: number[] = [];
  const pacer = new ProviderPacer(
    () => now,
    async (ms) => {
      slept.push(ms);
      if (advanceOnSleep) now += ms;
    },
  );
  return {
    pacer,
    slept,
    advance: (ms: number) => {
      now += ms;
    },
    at: () => now,
  };
}

describe('ProviderPacer', () => {
  it('lets the first send through with no wait', async () => {
    const { pacer, slept } = makePacer();
    expect(await pacer.take('ses', 14)).toBe(0);
    expect(slept).toEqual([]);
  });

  it('spaces consecutive sends at the provider’s own rate', async () => {
    const { pacer } = makePacer();
    // 2/s ⇒ one every 500ms.
    expect(await pacer.take('resend', 2)).toBe(0);
    expect(await pacer.take('resend', 2)).toBe(500);
    expect(await pacer.take('resend', 2)).toBe(500);
  });

  it('paces SES far more loosely than Resend', async () => {
    const { pacer } = makePacer();
    await pacer.take('ses', 14);
    // 14/s ⇒ ~71.4ms apart, not 500.
    expect(await pacer.take('ses', 14)).toBeCloseTo(1000 / 14, 5);
  });

  it('keeps each provider’s clock SEPARATE', async () => {
    // The whole point: a burst through SES must not make the next
    // credential email wait behind it, and vice versa.
    const { pacer } = makePacer();
    await pacer.take('ses', 14);
    await pacer.take('ses', 14);
    await pacer.take('ses', 14);
    expect(await pacer.take('resend', 2)).toBe(0);
  });

  it('charges nothing when enough time has already passed', async () => {
    const { pacer, advance } = makePacer();
    await pacer.take('resend', 2);
    advance(5_000);
    expect(await pacer.take('resend', 2)).toBe(0);
  });

  it('claims the slot BEFORE waiting, so concurrent callers queue rather than collide', async () => {
    // A read-then-write pacer lets three concurrent callers all read
    // "next free: now" and all go at once — the same shape that makes
    // an unlocked balance wrong. Frozen clock: all three start at t=0,
    // so the waits they ask for are the slots they were given.
    const { pacer } = makePacer({ advanceOnSleep: false });
    const waits = await Promise.all([
      pacer.take('resend', 2),
      pacer.take('resend', 2),
      pacer.take('resend', 2),
    ]);
    expect(waits).toEqual([0, 500, 1000]);
  });

  it('never divides by zero on a nonsensical rate', async () => {
    const { pacer } = makePacer();
    expect(await pacer.take('broken', 0)).toBe(0);
  });
});
