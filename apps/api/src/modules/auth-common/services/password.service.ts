import { Injectable } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import argon2 from 'argon2';

// OWASP-recommended argon2id parameters (verified 2024 guidance).
const HASH_OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 19456, // 19 MiB
  timeCost: 2,
  parallelism: 1,
} as const;

/**
 * A hash of a secret nobody knows, produced ONCE per process and used
 * only to burn the same argon2id work a real verify costs. Nothing can
 * match it, so the answer is always false and always discarded.
 *
 * Computed lazily rather than at import so a process that never
 * authenticates anybody does not pay ~19 MiB and ~50 ms for it. The
 * first unknown-email login therefore costs hash + verify instead of
 * verify — LONGER than a known email, never shorter, so the timing
 * oracle this closes cannot reopen on the first request.
 *
 * `.catch` on the promise rather than at the call site: an unawaited
 * rejected promise is an unhandled rejection, and an empty string makes
 * `verify` return false through its own catch, which is the behaviour
 * we want anyway.
 */
let dummyHash: Promise<string> | null = null;
function dummyVerifyTarget(): Promise<string> {
  dummyHash ??= argon2.hash(randomBytes(32).toString('base64url'), HASH_OPTIONS).catch(() => '');
  return dummyHash;
}

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
   * Spend the cost of a verify against a hash that can never match, and
   * throw the answer away.
   *
   * Every login refuses an unknown email with the same generic body as a
   * wrong password — but it refused it BEFORE reaching argon2, so the two
   * differed by ~50 ms of deliberately expensive hashing. That gap is
   * measurable over HTTP and answers "does this address have an account
   * here", which for a store user (globally unique email) is "is this
   * address a reseller-store login anywhere in the system".
   *
   * Call it on EVERY branch that refuses without verifying a real hash —
   * the address not existing, and the row being soft-deleted (that email
   * does exist, so skipping the work there re-opens the same oracle for
   * closed accounts).
   *
   * Returns void on purpose: there is no result worth having, and a
   * boolean would invite somebody to branch on it.
   */
  async verifyDummy(plaintext: string): Promise<void> {
    await this.verify(await dummyVerifyTarget(), plaintext);
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
