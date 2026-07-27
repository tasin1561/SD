import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/**
 * Module 9 — AES-256-GCM cipher for courier credentials (CUR-1).
 *
 * Wire format of `courier_credentials.encrypted_payload`: base64 of
 * `iv(12 bytes) || authTag(16 bytes) || ciphertext`. The 32-byte key is
 * supplied as 64 hex chars and lives ONLY in an env var
 * (`COURIER_CREDENTIALS_KEY_V<version>`) — NEVER in the DB (MUST NOT #1).
 *
 * The plaintext is a JSON object of credential fields (the row's
 * `fieldNames` lists the keys). Pure functions — no logging, no I/O;
 * plaintext never leaves the caller (MUST NOT #2).
 */

const IV_BYTES = 12;
const AUTH_TAG_BYTES = 16;
const KEY_BYTES = 32;

export class CourierCredentialCipherError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CourierCredentialCipherError';
  }
}

function keyBuffer(keyHex: string): Buffer {
  if (!/^[0-9a-fA-F]{64}$/.test(keyHex)) {
    throw new CourierCredentialCipherError(
      'courier credential key must be 64 hex chars (32 bytes)',
    );
  }
  return Buffer.from(keyHex, 'hex');
}

/** Encrypt a plaintext string → base64(iv || authTag || ciphertext). */
export function encryptCredential(plaintext: string, keyHex: string): string {
  const key = keyBuffer(keyHex);
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, ciphertext]).toString('base64');
}

/** Decrypt base64(iv || authTag || ciphertext) → plaintext string.
 *  Throws CourierCredentialCipherError on a bad key / tampered payload
 *  (GCM auth-tag mismatch). */
export function decryptCredential(payload: string, keyHex: string): string {
  const key = keyBuffer(keyHex);
  let blob: Buffer;
  try {
    blob = Buffer.from(payload, 'base64');
  } catch {
    throw new CourierCredentialCipherError('encrypted payload is not valid base64');
  }
  if (blob.length < IV_BYTES + AUTH_TAG_BYTES + 1) {
    throw new CourierCredentialCipherError('encrypted payload is too short');
  }
  const iv = blob.subarray(0, IV_BYTES);
  const authTag = blob.subarray(IV_BYTES, IV_BYTES + AUTH_TAG_BYTES);
  const ciphertext = blob.subarray(IV_BYTES + AUTH_TAG_BYTES);
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);
  try {
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
  } catch {
    // GCM auth failure — wrong key or tampered ciphertext. Never leak
    // the underlying crypto error detail.
    throw new CourierCredentialCipherError(
      'credential decryption failed (auth-tag mismatch — wrong key or tampered payload)',
    );
  }
}

/** Hex length of a valid AES-256 key — exported for env-validation reuse. */
export const COURIER_CREDENTIAL_KEY_HEX_LENGTH = KEY_BYTES * 2;
