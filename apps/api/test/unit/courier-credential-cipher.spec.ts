import {
  CourierCredentialCipherError,
  decryptCredential,
  encryptCredential,
} from '../../src/modules/courier-shared/util/courier-credential-cipher';

const KEY_A = 'a'.repeat(64);
const KEY_B = 'b'.repeat(64);

describe('courier-credential-cipher (AES-256-GCM)', () => {
  it('round-trips a credential JSON payload', () => {
    const plaintext = JSON.stringify({ token: 'secret-token', clientId: 'c1' });
    const encrypted = encryptCredential(plaintext, KEY_A);
    expect(encrypted).not.toContain('secret-token'); // ciphertext, not plaintext
    expect(decryptCredential(encrypted, KEY_A)).toBe(plaintext);
  });

  it('produces a different ciphertext each call (random IV)', () => {
    const a = encryptCredential('x', KEY_A);
    const b = encryptCredential('x', KEY_A);
    expect(a).not.toBe(b);
    expect(decryptCredential(a, KEY_A)).toBe('x');
    expect(decryptCredential(b, KEY_A)).toBe('x');
  });

  it('decrypt with the wrong key fails (auth-tag mismatch)', () => {
    const encrypted = encryptCredential('secret', KEY_A);
    expect(() => decryptCredential(encrypted, KEY_B)).toThrow(CourierCredentialCipherError);
  });

  it('decrypt of a tampered payload fails', () => {
    const encrypted = encryptCredential('secret', KEY_A);
    const blob = Buffer.from(encrypted, 'base64');
    const last = blob.length - 1;
    blob.writeUInt8(blob.readUInt8(last) ^ 0xff, last); // flip a ciphertext byte
    expect(() => decryptCredential(blob.toString('base64'), KEY_A)).toThrow(
      CourierCredentialCipherError,
    );
  });

  it('rejects a key that is not 64 hex chars', () => {
    expect(() => encryptCredential('x', 'tooshort')).toThrow(CourierCredentialCipherError);
    expect(() => decryptCredential('AAAA', 'tooshort')).toThrow(CourierCredentialCipherError);
  });

  it('rejects a payload shorter than iv+authTag+1', () => {
    const tiny = Buffer.alloc(10).toString('base64');
    expect(() => decryptCredential(tiny, KEY_A)).toThrow(CourierCredentialCipherError);
  });
});
