import { Injectable } from '@nestjs/common';
import argon2 from 'argon2';

// OWASP-recommended argon2id parameters (verified 2024 guidance).
const HASH_OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 19456, // 19 MiB
  timeCost: 2,
  parallelism: 1,
} as const;

@Injectable()
export class PasswordService {
  async hash(plaintext: string): Promise<string> {
    return argon2.hash(plaintext, HASH_OPTIONS);
  }

  /**
   * Constant-time verify. Returns false on any error (corrupt hash, mismatch).
   * Never throw — callers expect a boolean.
   */
  async verify(hash: string, plaintext: string): Promise<boolean> {
    try {
      return await argon2.verify(hash, plaintext);
    } catch {
      return false;
    }
  }

  /**
   * True if the hash was produced with parameters weaker than current targets,
   * indicating a rehash on next successful login. Useful when we bump
   * parameters in future deployments.
   */
  needsRehash(hash: string): boolean {
    return argon2.needsRehash(hash, HASH_OPTIONS);
  }
}
