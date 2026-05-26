import { describe, expect, it, vi } from 'vitest';
import { SingleFlightRefresh } from '../refresh/single-flight.js';

describe('SingleFlightRefresh', () => {
  it('coalesces concurrent callers: 3 simultaneous .run() calls → underlying refresh fires EXACTLY ONCE', async () => {
    let underlyingCalls = 0;
    // Refresh "resolves" only when we release it — lets us reliably
    // race three concurrent callers before any of them settles.
    let release!: () => void;
    const refreshGate = new Promise<void>((r) => {
      release = r;
    });
    const refresh = vi.fn(async () => {
      underlyingCalls += 1;
      await refreshGate;
      return 'OK' as const;
    });
    const sf = new SingleFlightRefresh(refresh);

    const a = sf.run();
    const b = sf.run();
    const c = sf.run();

    // All three got the SAME promise instance — observable here.
    expect(a).toBe(b);
    expect(b).toBe(c);
    expect(sf.isInFlight()).toBe(true);

    release();
    const [ra, rb, rc] = await Promise.all([a, b, c]);
    expect(ra).toBe('OK');
    expect(rb).toBe('OK');
    expect(rc).toBe('OK');

    // The key guarantee: ONE underlying refresh, never three. Without
    // single-flight, three concurrent rotate() calls would trip the
    // API's reuse-detection family-burn against a LEGITIMATE session.
    expect(underlyingCalls).toBe(1);
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(sf.isInFlight()).toBe(false);
  });

  it('after the in-flight settles, the NEXT .run() starts a fresh refresh', async () => {
    let calls = 0;
    const refresh = vi.fn(async () => {
      calls += 1;
      return 'OK' as const;
    });
    const sf = new SingleFlightRefresh(refresh);

    await sf.run();
    expect(calls).toBe(1);
    expect(sf.isInFlight()).toBe(false);

    // Second 401 (later) — a new refresh fires.
    await sf.run();
    expect(calls).toBe(2);
  });

  it('failure path: a failed refresh clears the in-flight state so the next 401 can retry', async () => {
    let calls = 0;
    const refresh = vi.fn(async () => {
      calls += 1;
      return 'FAILED' as const;
    });
    const sf = new SingleFlightRefresh(refresh);

    expect(await sf.run()).toBe('FAILED');
    expect(sf.isInFlight()).toBe(false);

    // Next 401 → fresh attempt allowed.
    expect(await sf.run()).toBe('FAILED');
    expect(calls).toBe(2);
  });

  it('throw path: a thrown refresh clears the in-flight state and rethrows', async () => {
    const err = new Error('network down');
    let calls = 0;
    const refresh = vi.fn(async () => {
      calls += 1;
      throw err;
    });
    const sf = new SingleFlightRefresh(refresh);

    await expect(sf.run()).rejects.toBe(err);
    expect(sf.isInFlight()).toBe(false);

    // Next 401 still gets a fresh attempt.
    await expect(sf.run()).rejects.toBe(err);
    expect(calls).toBe(2);
  });

  it('concurrent FAILED also coalesces — all waiters see FAILED, only one refresh fired', async () => {
    let calls = 0;
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const refresh = vi.fn(async () => {
      calls += 1;
      await gate;
      return 'FAILED' as const;
    });
    const sf = new SingleFlightRefresh(refresh);

    const a = sf.run();
    const b = sf.run();
    release();
    const [ra, rb] = await Promise.all([a, b]);
    expect(ra).toBe('FAILED');
    expect(rb).toBe('FAILED');
    expect(calls).toBe(1);
  });
});
