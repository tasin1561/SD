import { Injectable } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';

const API_KEY_PREFIX = 'skd_';
const API_KEY_ENTROPY_BYTES = 24; // url-safe base64 → 32 chars
const REFRESH_TOKEN_ENTROPY_BYTES = 32; // 256 bits
const RESET_TOKEN_ENTROPY_BYTES = 32;
const VERIFY_TOKEN_ENTROPY_BYTES = 32;
const INVITATION_TOKEN_ENTROPY_BYTES = 32;

@Injectable()
export class TokenHashService {
  /** Deterministic SHA-256 of plaintext, returned as lowercase hex. */
  sha256Hex(plaintext: string): string {
    return createHash('sha256').update(plaintext, 'utf8').digest('hex');
  }

  /** Generates a url-safe random token suitable for refresh/reset/verify flows. */
  generateRefreshToken(): string {
    return this.urlSafeRandom(REFRESH_TOKEN_ENTROPY_BYTES);
  }

  generatePasswordResetToken(): string {
    return this.urlSafeRandom(RESET_TOKEN_ENTROPY_BYTES);
  }

  generateEmailVerificationToken(): string {
    return this.urlSafeRandom(VERIFY_TOKEN_ENTROPY_BYTES);
  }

  generateInvitationToken(): string {
    return this.urlSafeRandom(INVITATION_TOKEN_ENTROPY_BYTES);
  }

  /**
   * Generates a seller API key plaintext + its prefix + its hash.
   * Format: `skd_` + 32 url-safe chars. The prefix that's safe to display is
   * the first 12 chars (`skd_` + first 8 of the random body).
   */
  generateApiKey(): { plaintext: string; prefix: string; hash: string } {
    const body = this.urlSafeRandom(API_KEY_ENTROPY_BYTES).slice(0, 32);
    const plaintext = API_KEY_PREFIX + body;
    const prefix = plaintext.slice(0, 12);
    const hash = this.sha256Hex(plaintext);
    return { plaintext, prefix, hash };
  }

  // --- internal ---

  private urlSafeRandom(bytes: number): string {
    return randomBytes(bytes)
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/g, '');
  }
}
