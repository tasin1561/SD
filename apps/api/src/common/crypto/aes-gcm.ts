import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/**
 * Generic AES-256-GCM cipher — extracted from M9 courier-credential
 * cipher when bank-account encryption (Phase 1B #2) needed a second
 * use site.
 *
 * Wire format: base64 of `iv(12 bytes) || authTag(16 bytes) || ciphertext`.
 * The 32-byte key is supplied as 64 hex chars and lives ONLY in env
 * vars (`<DOMAIN>_KEY_V<version>`), NEVER in the DB.
 *
 * Pure functions — no logging, no I/O; plaintext never leaves the
 * caller. The dedicated key + IV per encrypt mean two encryptions of
 * the same plaintext produce DIFFERENT ciphertexts (semantic security).
 */

const IV_BYTES = 12;
const AUTH_TAG_BYTES = 16;
const KEY_BYTES = 32;

export class AesGcmCipherError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AesGcmCipherError';
  }
}

function keyBuffer(keyHex: string, domain: string): Buffer {
  if (!/^[0-9a-fA-F]{64}$/.test(keyHex)) {
    throw new AesGcmCipherError(`${domain} key must be 64 hex chars (32 bytes)`);
  }
  return Buffer.from(keyHex, 'hex');
}

/** Encrypt UTF-8 plaintext → base64 ciphertext blob. */
export function aesGcmEncrypt(plaintext: string, keyHex: string, domain = 'encryption'): string {
  const key = keyBuffer(keyHex, domain);
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, ciphertext]).toString('base64');
}

/** Decrypt base64 ciphertext blob → UTF-8 plaintext.
 *  Throws AesGcmCipherError on a bad key / tampered payload. */
export function aesGcmDecrypt(payload: string, keyHex: string, domain = 'encryption'): string {
  const key = keyBuffer(keyHex, domain);
  let blob: Buffer;
  try {
    blob = Buffer.from(payload, 'base64');
  } catch {
    throw new AesGcmCipherError(`${domain} payload is not valid base64`);
  }
  if (blob.length < IV_BYTES + AUTH_TAG_BYTES + 1) {
    throw new AesGcmCipherError(`${domain} payload is too short`);
  }
  const iv = blob.subarray(0, IV_BYTES);
  const authTag = blob.subarray(IV_BYTES, IV_BYTES + AUTH_TAG_BYTES);
  const ciphertext = blob.subarray(IV_BYTES + AUTH_TAG_BYTES);
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);
  try {
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
  } catch {
    throw new AesGcmCipherError(
      `${domain} decryption failed (auth-tag mismatch — wrong key or tampered payload)`,
    );
  }
}

export const AES_GCM_KEY_HEX_LENGTH = KEY_BYTES * 2;
