import {
  IMMEDIATE_RETRY_DELAY_MS,
  MAX_INLINE_RETRY_AFTER_MS,
  retryOnceOnTransient,
} from '../../src/modules/address-check/services/solustation-retry';
import {
  SOLUSTATION_ERROR_NAME,
  type SolustationError,
  type SolustationFailure,
} from '../../src/modules/address-check/types/solustation.types';

/*
  The brief: "Timeout / 5xx: retry once after 2 s with the same
  reference_id (free, idempotent); still failing -> treat as
  confirm_with_customer, never approve. 429 -> wait Retry-After."

  Two properties carry the weight here and both are asserted directly
  rather than inferred: it retries exactly ONCE (never a loop), and a
  failure that is OUR fault or the KEY's fault is not retried at all.
*/

function fail(
  classification: SolustationFailure,
  over: Partial<SolustationError> = {},
): SolustationError {
  const e = new Error(`simulated ${classification}`) as SolustationError;
  e.name = SOLUSTATION_ERROR_NAME;
  Object.assign(e, { classification, retryable: true }, over);
  return e;
}

/** Records what was waited for instead of actually waiting. */
function recorder() {
  const waited: number[] = [];
  return { waited, wait: async (ms: number): Promise<void> => void waited.push(ms) };
}

describe('retryOnceOnTransient', () => {
  it('does not retry a call that succeeds', async () => {
    const attempt = jest.fn(async () => 'ok');
    const { waited, wait } = recorder();
    await expect(retryOnceOnTransient(attempt, { wait })).resolves.toBe('ok');
    expect(attempt).toHaveBeenCalledTimes(1);
    expect(waited).toEqual([]);
  });

  it.each<SolustationFailure>(['TIMEOUT', 'NETWORK', 'SERVER'])(
    'retries %s once, after 2 seconds',
    async (classification) => {
      const attempt = jest
        .fn<Promise<string>, []>()
        .mockRejectedValueOnce(fail(classification))
        .mockResolvedValueOnce('second time lucky');
      const { waited, wait } = recorder();

      await expect(retryOnceOnTransient(attempt, { wait })).resolves.toBe('second time lucky');
      expect(attempt).toHaveBeenCalledTimes(2);
      expect(waited).toEqual([IMMEDIATE_RETRY_DELAY_MS]);
    },
  );

  it('retries ONCE and no more — the second failure is re-thrown', async () => {
    // The guard against a retry loop holding a request open while an
    // operator waits. Two attempts, then it is the caller's problem.
    const attempt = jest
      .fn<Promise<string>, []>()
      .mockRejectedValueOnce(fail('SERVER'))
      .mockRejectedValueOnce(fail('TIMEOUT'));
    const { wait } = recorder();

    await expect(retryOnceOnTransient(attempt, { wait })).rejects.toMatchObject({
      classification: 'TIMEOUT',
    });
    expect(attempt).toHaveBeenCalledTimes(2);
  });

  it.each<SolustationFailure>(['BAD_REQUEST', 'AUTH', 'STUB'])(
    'never retries %s',
    async (classification) => {
      // 422 is our body being wrong and re-sending it gets the same
      // answer; 401/403 is the key, and a retry loop against an auth
      // failure is how an account gets locked out.
      const attempt = jest
        .fn<Promise<string>, []>()
        .mockRejectedValue(fail(classification, { retryable: false }));
      const { waited, wait } = recorder();

      await expect(retryOnceOnTransient(attempt, { wait })).rejects.toMatchObject({
        classification,
      });
      expect(attempt).toHaveBeenCalledTimes(1);
      expect(waited).toEqual([]);
    },
  );

  it('does not retry a non-Solustation error', async () => {
    const attempt = jest.fn<Promise<string>, []>().mockRejectedValue(new TypeError('bug'));
    const { wait } = recorder();
    await expect(retryOnceOnTransient(attempt, { wait })).rejects.toBeInstanceOf(TypeError);
    expect(attempt).toHaveBeenCalledTimes(1);
  });

  describe('429 waits the period the service asked for', () => {
    it('honours a short Retry-After', async () => {
      const attempt = jest
        .fn<Promise<string>, []>()
        .mockRejectedValueOnce(fail('RATE_LIMITED', { retryAfterSeconds: 3 }))
        .mockResolvedValueOnce('ok');
      const { waited, wait } = recorder();

      await expect(retryOnceOnTransient(attempt, { wait })).resolves.toBe('ok');
      expect(waited).toEqual([3_000]);
    });

    it('falls back to 2 s when the header is absent', async () => {
      const attempt = jest
        .fn<Promise<string>, []>()
        .mockRejectedValueOnce(fail('RATE_LIMITED'))
        .mockResolvedValueOnce('ok');
      const { waited, wait } = recorder();

      await expect(retryOnceOnTransient(attempt, { wait })).resolves.toBe('ok');
      expect(waited).toEqual([IMMEDIATE_RETRY_DELAY_MS]);
    });

    it('declines to wait inline for a long Retry-After, leaving it to the sweep', async () => {
      const seconds = MAX_INLINE_RETRY_AFTER_MS / 1_000 + 30;
      const attempt = jest
        .fn<Promise<string>, []>()
        .mockRejectedValue(fail('RATE_LIMITED', { retryAfterSeconds: seconds }));
      const { waited, wait } = recorder();

      await expect(retryOnceOnTransient(attempt, { wait })).rejects.toMatchObject({
        classification: 'RATE_LIMITED',
      });
      // Not retried, and above all not slept on: a person is waiting.
      expect(attempt).toHaveBeenCalledTimes(1);
      expect(waited).toEqual([]);
    });
  });

  it('reports the retry so it is visible in the log', async () => {
    const onRetry = jest.fn();
    const attempt = jest
      .fn<Promise<string>, []>()
      .mockRejectedValueOnce(fail('SERVER'))
      .mockResolvedValueOnce('ok');
    const { wait } = recorder();

    await retryOnceOnTransient(attempt, { wait, onRetry });
    expect(onRetry).toHaveBeenCalledWith(IMMEDIATE_RETRY_DELAY_MS, 'SERVER');
  });
});
