import { Injectable, Logger } from '@nestjs/common';
import { AesGcmCipherError, aesGcmDecrypt, aesGcmEncrypt } from '../../../common/crypto/aes-gcm';
import { EnvService } from '../../../config/env.service';

/**
 * Phase 1B #2 — encrypt-on-write / decrypt-with-mask for the
 * `sellers.bank_account_number` field.
 *
 * Wire:
 *   plaintext     — what the seller types
 *   ciphertext    — base64(iv||authTag||ciphertext), stored in
 *                   `bank_account_number`
 *   keyVersion    — int, stored in `bank_account_number_key_version`,
 *                   non-null means "encrypted"
 *   masked        — plaintext last-4 (or all chars if <=4), stored
 *                   in `bank_account_number_masked` for display
 *
 * When `BANK_ACCOUNTS_KEY_V1` env is empty, encryption is disabled:
 * `encrypt()` returns the plaintext as-is with keyVersion=null. This
 * preserves the dev/test path without leaking partially-encrypted
 * state into the DB.
 */

const CURRENT_KEY_VERSION = 1;

export interface EncryptResult {
  readonly storedValue: string | null;
  readonly masked: string | null;
  readonly keyVersion: number | null;
}

@Injectable()
export class BankAccountCipherService {
  private readonly logger = new Logger(BankAccountCipherService.name);

  constructor(private readonly env: EnvService) {}

  /** Derive the last-4 display value. Inputs <=4 chars are returned
   *  verbatim because masking them would hide everything. */
  private static maskLast4(plaintext: string): string {
    const trimmed = plaintext.trim();
    if (trimmed.length <= 4) return trimmed;
    return `${'•'.repeat(Math.min(trimmed.length - 4, 12))}${trimmed.slice(-4)}`;
  }

  /** Encrypt a plaintext account number for storage. Returns the
   *  storedValue, masked display, and key version (or null when
   *  encryption is disabled — plaintext path). */
  encrypt(plaintext: string | null): EncryptResult {
    if (plaintext === null || plaintext.trim() === '') {
      return { storedValue: null, masked: null, keyVersion: null };
    }
    const key = this.env.bankAccountsKey(CURRENT_KEY_VERSION);
    if (key === '') {
      // Encryption disabled — return plaintext as-is with null version.
      this.logger.warn(
        'BANK_ACCOUNTS_KEY_V1 unset; storing bank account number as plaintext (legacy / dev mode)',
      );
      return {
        storedValue: plaintext,
        masked: BankAccountCipherService.maskLast4(plaintext),
        keyVersion: null,
      };
    }
    const ciphertext = aesGcmEncrypt(plaintext, key, 'bank-account');
    return {
      storedValue: ciphertext,
      masked: BankAccountCipherService.maskLast4(plaintext),
      keyVersion: CURRENT_KEY_VERSION,
    };
  }

  /**
   * Decrypt a stored value for an authorised reveal (admin reveal
   * endpoint or remittance form bank-account-snapshot capture).
   *
   * - keyVersion=null → already plaintext (legacy / dev mode); return as-is.
   * - keyVersion=N    → decrypt with `BANK_ACCOUNTS_KEY_V<N>`. Throws
   *                     if the key version's env is unset.
   * - storedValue=null → null.
   */
  reveal(storedValue: string | null, keyVersion: number | null): string | null {
    if (storedValue === null || storedValue.trim() === '') return null;
    if (keyVersion === null) return storedValue;
    const key = this.env.bankAccountsKey(keyVersion);
    if (key === '') {
      throw new AesGcmCipherError(
        `BANK_ACCOUNTS_KEY_V${keyVersion} is not configured; cannot decrypt`,
      );
    }
    return aesGcmDecrypt(storedValue, key, 'bank-account');
  }
}
