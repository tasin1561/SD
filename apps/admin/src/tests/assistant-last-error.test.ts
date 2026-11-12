import { beforeEach, describe, expect, it } from 'vitest';
import { ApiError } from '@skydrop/api-client';
import { clearLastError, readLastError } from '@skydrop/ui/app/last-error';
import { serverVerdict } from '@/lib/server-verdict';

/**
 * The assistant learns "what just went wrong" from the ONE place a server
 * refusal becomes on-screen text. If a screen formats a verdict, the next
 * assistant question carries it; no screen needs to know.
 */
describe('serverVerdict records the last error for the assistant', () => {
  beforeEach(() => clearLastError());

  it('records the code and the message that was shown', () => {
    const shown = serverVerdict(
      new ApiError(409, 'WALLET_LOW', { code: 'WALLET_LOW', message: 'Balance too low' }),
    );
    expect(shown).toBe('[WALLET_LOW] Balance too low');
    expect(readLastError()).toMatchObject({ code: 'WALLET_LOW', message: 'Balance too low' });
  });

  it('records nothing for a plain Error that is not a server verdict', () => {
    serverVerdict(new Error('local'));
    expect(readLastError()).toBeNull();
  });

  it('the latest error replaces the earlier one', () => {
    serverVerdict(new ApiError(400, 'A', { code: 'A', message: 'first' }));
    serverVerdict(new ApiError(400, 'B', { code: 'B', message: 'second' }));
    expect(readLastError()?.code).toBe('B');
  });
});
