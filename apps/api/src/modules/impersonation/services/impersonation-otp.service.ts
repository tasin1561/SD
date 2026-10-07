import { Injectable, Logger } from '@nestjs/common';
import { randomInt, timingSafeEqual } from 'node:crypto';
import { NotificationRecipientType } from '@skydrop/db';
import { RedisService } from '../../../infrastructure/redis/redis.service';
import { EmailQueue } from '../../email/queue/email.queue';
import { TokenHashService } from '../../auth-common/services/token-hash.service';

/**
 * The staff member's second factor for going inside somebody's account.
 *
 * ── WHOSE INBOX, AND WHY IT MATTERS ─────────────────────────────────
 * The code goes to the STAFF member who asked, never to the seller. It
 * is not the seller's consent — consent is not what this is for, and
 * asking a seller to read out a code would turn every support session
 * into a social-engineering lesson we taught them ourselves. It is
 * proof that the person driving the admin console is the person whose
 * login it is. A stolen staff session can read the admin app; it cannot
 * read that person's mail, and this is the step that makes the
 * difference.
 *
 * ── WHY REDIS AND NOT A COLUMN ──────────────────────────────────────
 * `impersonation_sessions` deliberately has no code and no attempt
 * counter. The code and the count are live-for-ten-minutes facts about
 * one unfinished attempt, and the session row is the PERMANENT record a
 * reviewer reads years later; putting a dead secret's hash in it would
 * mean keeping a credential column for ever to serve a ten-minute need.
 *
 * The cost is that a Redis flush loses pending codes. That is the right
 * way for this to fail: the staff member presses the button again. The
 * session row survives either way with `otpVerifiedAt` still null, so
 * an abandoned attempt is still visible in the review — which is the
 * fact somebody might actually want.
 *
 * ── WHAT THE HASH BUYS, HONESTLY ────────────────────────────────────
 * Six digits is a million possibilities, so SHA-256 of one is not a
 * serious obstacle to anybody holding the hash and a spare second. The
 * hash is here so the LIVE code is not sitting in plaintext in a store
 * that gets dumped into bug reports, read by `redis-cli KEYS` over
 * somebody's shoulder, or scraped by a `MONITOR`. The actual defences
 * are the ten-minute window and the five-guess cap below, and those are
 * what make the key space big enough.
 */

/** Long enough to fetch a phone, short enough to be worthless if leaked later. */
export const IMPERSONATION_OTP_TTL_MINUTES = 10;

/**
 * Five guesses against a million codes is a one-in-two-hundred-thousand
 * chance, and the sixth guess does not get to happen: the SESSION dies,
 * not just the code. Re-requesting costs the staff member fifteen
 * seconds and leaves a second `requested` row in the audit log, which
 * is exactly the trail somebody brute-forcing would rather not leave.
 */
export const MAX_IMPERSONATION_OTP_ATTEMPTS = 5;

/**
 * The failure counter outlives the code on purpose. If it expired with
 * the code, waiting ten minutes and asking again would reset the count
 * for free — and the counter is keyed on the session, which cannot be
 * re-requested without a new session row.
 */
const FAIL_COUNTER_TTL_SECONDS = (IMPERSONATION_OTP_TTL_MINUTES + 20) * 60;

const codeKey = (sessionId: string): string => `impersonation:otp:${sessionId}`;
const failKey = (sessionId: string): string => `impersonation:otp:fails:${sessionId}`;

/** Why a code was refused. Each one is said differently to the caller. */
export type OtpRefusal =
  /** No live code for this session — never sent, already used, or expired. */
  | 'NO_LIVE_CODE'
  /** Wrong digits, and there are guesses left. */
  | 'MISMATCH'
  /** The guesses are gone. The session must be abandoned. */
  | 'ATTEMPTS_EXHAUSTED';

export type OtpCheckResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly refusal: OtpRefusal; readonly attemptsLeft: number };

/**
 * A fresh six-digit code, cryptographically random.
 *
 * `randomInt` and not `Math.random()`: the whole value of this step is
 * that the code cannot be predicted by somebody who knows when it was
 * issued, and `Math.random()` is a seeded PRNG that makes that exact
 * guess cheap. Zero-padded rather than ranged from 100000, so 000123 is
 * as likely as any other code and the space really is a million.
 *
 * Pure and exported so the generator can be tested without a Redis.
 */
export function generateImpersonationOtp(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, '0');
}

/** Whole minutes from now until `when`, never less than one. */
function minutesUntil(when: Date): number {
  return Math.max(1, Math.round((when.getTime() - Date.now()) / 60_000));
}

/** Only ever six digits reaches the store; anything else is not a guess. */
export function isWellFormedOtp(code: string): boolean {
  return /^[0-9]{6}$/.test(code);
}

export interface IssueOtpInput {
  readonly sessionId: string;
  readonly staffUserId: string;
  readonly staffEmail: string;
  readonly staffName: string;
  /** What they are about to be inside, in words a person recognises. */
  readonly subjectLabel: string;
  readonly mayWrite: boolean;
  readonly reason: string;
  /**
   * The SESSION's deadline, which is not the code's. The mail says both
   * because they are different promises: the code dies in ten minutes
   * whether or not it is used, and the session dies thirty minutes from
   * when it was asked for whether or not it is finished with.
   */
  readonly expiresAt: Date;
}

@Injectable()
export class ImpersonationOtpService {
  private readonly logger = new Logger(ImpersonationOtpService.name);

  constructor(
    private readonly redis: RedisService,
    private readonly email: EmailQueue,
    private readonly hashes: TokenHashService,
  ) {}

  /**
   * Mint a code, store its hash, and mail the plaintext.
   *
   * Returns nothing but the deadline. The code is never returned, never
   * logged and never audited — the only copy outside the staff member's
   * inbox is the SHA-256 in Redis, and that is the point. An endpoint
   * that handed the code back would make the second factor a formality
   * for whoever already held the first one.
   */
  async issue(input: IssueOtpInput): Promise<{ readonly otpExpiresAt: Date }> {
    const code = generateImpersonationOtp();
    const ttlSeconds = IMPERSONATION_OTP_TTL_MINUTES * 60;
    const otpExpiresAt = new Date(Date.now() + ttlSeconds * 1000);

    await this.redis.client.set(
      codeKey(input.sessionId),
      this.hashes.sha256Hex(code),
      'EX',
      ttlSeconds,
    );
    // A fresh code starts a fresh count. The session is new, so there is
    // nothing to carry over, and leaving a stale counter behind would
    // lock out a session that has not been guessed at once.
    await this.redis.client.del(failKey(input.sessionId));

    await this.email.enqueue({
      templateCode: 'staff.impersonation_otp.email',
      recipient: {
        type: NotificationRecipientType.STAFF,
        id: input.staffUserId,
        email: input.staffEmail,
      },
      variables: {
        staff_name: input.staffName,
        subject_label: input.subjectLabel,
        access: input.mayWrite ? 'read and write' : 'read-only',
        reason: input.reason,
        code,
        expires_minutes: String(IMPERSONATION_OTP_TTL_MINUTES),
        session_minutes: String(minutesUntil(input.expiresAt)),
      },
    });

    // Deliberately WITHOUT the code. Everything here is safe to read in
    // a log; one more field would not be.
    this.logger.log(
      { sessionId: input.sessionId, staffUserId: input.staffUserId },
      'Impersonation OTP issued',
    );
    return { otpExpiresAt };
  }

  /**
   * Check a guess, consuming the code if it is right.
   *
   * SINGLE USE: a correct code is deleted in the same breath, so the
   * same digits cannot verify a second session, and a code read off a
   * forwarded mail is dead the moment the real owner has used it.
   *
   * The caller is told how many guesses are left so it can decide what
   * to do when they run out — ending the session is a lifecycle
   * decision and belongs with the rest of the lifecycle, not here.
   */
  async check(sessionId: string, code: string): Promise<OtpCheckResult> {
    // Count the attempt FIRST. A guess that is counted only when it
    // turns out to be wrong is a guess an attacker can retry by
    // crashing us mid-request; counting up front means the worst a
    // failure costs is one of the staff member's own five tries.
    const attempts = await this.countAttempt(sessionId);
    if (attempts > MAX_IMPERSONATION_OTP_ATTEMPTS) {
      // `burnCode`, NOT `revoke`: revoke deletes the fail counter too,
      // so the guess that trips the cap would zero the thing that
      // tripped it and the NEXT guess would be counted as attempt 1
      // against a 5-try budget. The code is gone either way, so nobody
      // gets in — what was lost was the SIGNAL. `ATTEMPTS_EXHAUSTED`
      // was observable exactly once, and a caller that retried, polled,
      // or simply arrived a request late saw `NO_LIVE_CODE`, which is
      // indistinguishable from an ordinary expiry, and so never ended
      // the session it was supposed to end.
      await this.burnCode(sessionId);
      return { ok: false, refusal: 'ATTEMPTS_EXHAUSTED', attemptsLeft: 0 };
    }
    const attemptsLeft = MAX_IMPERSONATION_OTP_ATTEMPTS - attempts;

    if (!isWellFormedOtp(code)) {
      return { ok: false, refusal: 'MISMATCH', attemptsLeft };
    }

    const stored = await this.redis.client.get(codeKey(sessionId));
    if (stored === null) {
      return { ok: false, refusal: 'NO_LIVE_CODE', attemptsLeft };
    }
    if (!this.hashesMatch(stored, this.hashes.sha256Hex(code))) {
      if (attemptsLeft === 0) {
        // The guess that USES the last try is the one that exhausts it.
        // Saying `ATTEMPTS_EXHAUSTED` while leaving the code live in
        // Redis made this a promise kept on somebody else's behalf: the
        // caller was told the guesses were gone, and whether the code
        // actually died depended on the lifecycle layer remembering to
        // revoke it. It dies here, where the fact is known.
        await this.burnCode(sessionId);
        return { ok: false, refusal: 'ATTEMPTS_EXHAUSTED', attemptsLeft: 0 };
      }
      return { ok: false, refusal: 'MISMATCH', attemptsLeft };
    }

    await this.revoke(sessionId);
    return { ok: true };
  }

  /**
   * Forget the code and the count.
   *
   * Called when a session ends for any reason, so a code mailed for a
   * session somebody then abandoned cannot be typed into it later.
   */
  async revoke(sessionId: string): Promise<void> {
    await this.redis.client.del(codeKey(sessionId), failKey(sessionId));
  }

  /**
   * Kill the CODE and leave the counter standing.
   *
   * The difference from `revoke` is the whole of findings 2a/2b: a
   * counter cleared by the guess that tripped it makes the exhausted
   * state last exactly one call, and the state is the only thing that
   * tells a caller to end the session. The counter carries its own TTL
   * from `countAttempt`, so it tidies itself up.
   */
  private async burnCode(sessionId: string): Promise<void> {
    await this.redis.client.del(codeKey(sessionId));
  }

  // --- internal ---

  /** The attempt number this guess is, 1-based. */
  private async countAttempt(sessionId: string): Promise<number> {
    const key = failKey(sessionId);
    const n = await this.redis.client.incr(key);
    // INCR on a missing key creates it with no TTL, which would leave
    // the counter behind for ever. Set the expiry on the first one only
    // — re-setting it on every guess would let a patient attacker keep
    // the window open indefinitely.
    if (n === 1) await this.redis.client.expire(key, FAIL_COUNTER_TTL_SECONDS);
    return n;
  }

  /**
   * Constant-time over the hex digests.
   *
   * `===` on two hashes leaks, through how long the comparison takes,
   * how many leading characters a guess got right — which over enough
   * requests is a way to learn the hash a digit at a time. The hashes
   * are the same length by construction, but the length check stays
   * because `timingSafeEqual` THROWS on a mismatch rather than
   * returning false.
   */
  private hashesMatch(a: string, b: string): boolean {
    const left = Buffer.from(a, 'utf8');
    const right = Buffer.from(b, 'utf8');
    if (left.length !== right.length) return false;
    return timingSafeEqual(left, right);
  }
}
