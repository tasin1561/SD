import { BankAccountCipherService } from './bank-account-cipher.service';
import { makeTestEnv } from '../../../../test/helpers/env';

/**
 * Phase 1B #2 — bank account cipher unit tests.
 *
 * Pinned behaviour:
 *  - encrypt + reveal round-trips
 *  - ciphertext is non-deterministic (each encrypt has a fresh IV)
 *  - masked display is last-4 with bullet padding
 *  - empty/null input passes through with null version
 *  - encryption-disabled mode (env key empty) returns plaintext +
 *    null version
 *  - reveal of plaintext (null version) is a no-op pass-through
 *  - reveal throws when key version is unconfigured
 *  - reveal throws on tampered ciphertext (auth-tag mismatch)
 */
describe('BankAccountCipherService', () => {
  it('encrypts + reveals; round-trips plaintext', () => {
    const svc = new BankAccountCipherService(makeTestEnv());
    const plaintext = '1234567890123456';

    const enc = svc.encrypt(plaintext);
    expect(enc.storedValue).not.toBeNull();
    expect(enc.storedValue).not.toBe(plaintext);
    expect(enc.keyVersion).toBe(1);
    expect(enc.masked).toBe('••••••••••••3456');

    const revealed = svc.reveal(enc.storedValue, enc.keyVersion);
    expect(revealed).toBe(plaintext);
  });

  it('produces a fresh ciphertext per encrypt (semantic security)', () => {
    const svc = new BankAccountCipherService(makeTestEnv());
    const a = svc.encrypt('same-account');
    const b = svc.encrypt('same-account');
    expect(a.storedValue).not.toBe(b.storedValue);
  });

  it('handles null + empty input as a clear (no encryption, no masked)', () => {
    const svc = new BankAccountCipherService(makeTestEnv());
    for (const v of [null, '', '   ']) {
      const enc = svc.encrypt(v);
      expect(enc.storedValue).toBeNull();
      expect(enc.masked).toBeNull();
      expect(enc.keyVersion).toBeNull();
    }
  });

  it('masks short accounts verbatim (<= 4 chars)', () => {
    const svc = new BankAccountCipherService(makeTestEnv());
    expect(svc.encrypt('1').masked).toBe('1');
    expect(svc.encrypt('1234').masked).toBe('1234');
  });

  it('encryption-disabled mode (empty key) stores plaintext + null version', () => {
    const svc = new BankAccountCipherService(
      makeTestEnv({ BANK_ACCOUNTS_KEY_V1: '' }),
    );
    const enc = svc.encrypt('1234567890');
    expect(enc.storedValue).toBe('1234567890');
    expect(enc.keyVersion).toBeNull();
    expect(enc.masked).toBe('••••••7890');
  });

  it('reveal passes plaintext through when keyVersion is null', () => {
    const svc = new BankAccountCipherService(
      makeTestEnv({ BANK_ACCOUNTS_KEY_V1: '' }),
    );
    expect(svc.reveal('legacy-plaintext-value', null)).toBe(
      'legacy-plaintext-value',
    );
  });

  it('reveal throws when the key version is unconfigured', () => {
    const svc = new BankAccountCipherService(
      makeTestEnv({ BANK_ACCOUNTS_KEY_V1: '' }),
    );
    expect(() => svc.reveal('some-ciphertext', 1)).toThrow(
      /BANK_ACCOUNTS_KEY_V1 is not configured/,
    );
  });

  it('reveal throws on tampered ciphertext (auth-tag mismatch)', () => {
    const svc = new BankAccountCipherService(makeTestEnv());
    const enc = svc.encrypt('original-value');
    const tampered = (enc.storedValue ?? '').slice(0, -4) + 'AAAA';
    expect(() => svc.reveal(tampered, 1)).toThrow(/auth-tag mismatch/);
  });
});
