import { Logger } from '@nestjs/common';
import {
  IMPERSONATION_OTP_TTL_MINUTES,
  ImpersonationOtpService,
  MAX_IMPERSONATION_OTP_ATTEMPTS,
  generateImpersonationOtp,
  isWellFormedOtp,
  type IssueOtpInput,
} from '../../src/modules/impersonation/services/impersonation-otp.service';
import { TokenHashService } from '../../src/modules/auth-common/services/token-hash.service';
import type { EmailDispatchInput } from '../../src/modules/email/email.types';
import type { EmailQueue } from '../../src/modules/email/queue/email.queue';
import type { RedisService } from '../../src/infrastructure/redis/redis.service';

/**
 * The second factor on going inside somebody else's account.
 *
 * ── WHY THIS TEST EXISTS ─────────────────────────────────────────────
 * This step is the only thing standing between a stolen admin session
 * and a seller's account. Whoever holds the console can already read the
 * admin app; the code proves they can also read the staff member's mail.
 * Every property below is load-bearing in a different way:
 *
 *   - SINGLE USE. A code that verified twice would mean a forwarded
 *     mail, or a code read over somebody's shoulder, stayed usable after
 *     its owner had used it.
 *   - EXPIRY. A code that never died would be a permanent credential
 *     sitting in a mailbox, and an old support mail would be a way in a
 *     year later.
 *   - AN ATTEMPT CAP. Six digits is a million possibilities, which is
 *     only a wall if the guesses are counted. Without the cap a script
 *     walks the whole space in minutes and the second factor is theatre.
 *   - NEVER IN PLAINTEXT, ANYWHERE BUT THE INBOX. A code returned from
 *     the endpoint, or written into a log, is available to exactly the
 *     person the step is meant to stop — they already have the console
 *     and they probably have the logs.
 *
 * ── WHY A FAKE REDIS AND THE REAL HASHER ─────────────────────────────
 * The hashing is the part a bug would hide in, so `TokenHashService` is
 * the real one. Redis is faked because what matters is what was STORED
 * and for how long, and asserting that against a real server would make
 * a unit test need a server. The fake tracks expiry against a clock the
 * test moves, so "ten minutes later" is a real assertion rather than a
 * comment.
 */

type SetArgs = [key: string, value: string, mode: 'EX', ttlSeconds: number];

/**
 * Just enough ioredis for this service: a string store with expiry, a
 * counter, and a multi-key delete. Every TTL is recorded so a test can
 * assert on it rather than guess.
 */
class FakeRedis {
  private readonly values = new Map<string, string>();
  private readonly expiresAt = new Map<string, number>();
  now = 0;
  readonly sets: SetArgs[] = [];

  private sweep(key: string): void {
    const at = this.expiresAt.get(key);
    if (at !== undefined && at <= this.now) {
      this.values.delete(key);
      this.expiresAt.delete(key);
    }
  }

  async set(key: string, value: string, mode: 'EX', ttlSeconds: number): Promise<'OK'> {
    this.sets.push([key, value, mode, ttlSeconds]);
    this.values.set(key, value);
    this.expiresAt.set(key, this.now + ttlSeconds);
    return 'OK';
  }

  async get(key: string): Promise<string | null> {
    this.sweep(key);
    return this.values.get(key) ?? null;
  }

  async del(...keys: string[]): Promise<number> {
    let removed = 0;
    for (const key of keys) {
      if (this.values.delete(key)) removed += 1;
      this.expiresAt.delete(key);
    }
    return removed;
  }

  async incr(key: string): Promise<number> {
    this.sweep(key);
    const next = Number(this.values.get(key) ?? '0') + 1;
    this.values.set(key, String(next));
    return next;
  }

  async expire(key: string, ttlSeconds: number): Promise<number> {
    if (!this.values.has(key)) return 0;
    this.expiresAt.set(key, this.now + ttlSeconds);
    return 1;
  }

  /** What is actually sitting in the store, for the plaintext checks. */
  snapshot(): Array<[string, string]> {
    return [...this.values.entries()];
  }

  ttlOf(key: string): number | undefined {
    const at = this.expiresAt.get(key);
    return at === undefined ? undefined : at - this.now;
  }

  advanceMinutes(minutes: number): void {
    this.now += minutes * 60;
  }
}

const SESSION_ID = '0190d4e1-11aa-7bcd-8e01-2f3a4b5c6d77';
const STAFF_ID = '0190d4e1-22bb-7cde-9f12-3a4b5c6d7e88';

function makeSut(): {
  svc: ImpersonationOtpService;
  redis: FakeRedis;
  mails: EmailDispatchInput[];
  logged: unknown[][];
  codeKey: string;
  failKey: string;
} {
  const redis = new FakeRedis();
  const mails: EmailDispatchInput[] = [];
  const email = {
    enqueue: jest.fn(async (input: EmailDispatchInput) => {
      mails.push(input);
      return 'job-1';
    }),
  } as unknown as EmailQueue;

  /*
    Every Logger channel is captured, not just `log`. A code that
    appeared only in a warning or an error line would still be a code in
    the log aggregator, and that is the branch somebody reaches for when
    they are debugging and in a hurry.
  */
  const logged: unknown[][] = [];
  for (const level of ['log', 'warn', 'error', 'debug', 'verbose'] as const) {
    jest.spyOn(Logger.prototype, level).mockImplementation((...args: unknown[]) => {
      logged.push(args);
    });
  }

  const svc = new ImpersonationOtpService(
    { client: redis } as unknown as RedisService,
    email,
    new TokenHashService(),
  );

  return {
    svc,
    redis,
    mails,
    logged,
    codeKey: `impersonation:otp:${SESSION_ID}`,
    failKey: `impersonation:otp:fails:${SESSION_ID}`,
  };
}

function issueInput(overrides: Partial<IssueOtpInput> = {}): IssueOtpInput {
  return {
    sessionId: SESSION_ID,
    staffUserId: STAFF_ID,
    staffEmail: 'support@example.com',
    staffName: 'Asha',
    subjectLabel: 'Kalpana Textiles (seller)',
    mayWrite: false,
    reason: 'checking a payout they say is missing',
    // The SESSION's deadline, which is not the code's — thirty minutes
    // against the code's ten. Relative to now, because the mail does
    // arithmetic on it.
    expiresAt: new Date(Date.now() + 30 * 60 * 1000),
    ...overrides,
  };
}

/** The plaintext, read back from the only place it is allowed to be. */
function mailedCode(mails: EmailDispatchInput[]): string {
  const code = mails[0]?.variables?.['code'];
  expect(typeof code).toBe('string');
  return code as string;
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe('generateImpersonationOtp', () => {
  it('is always exactly six digits', () => {
    // Zero-padded rather than ranged from 100000, so 000123 is as
    // likely as any other code. A generator that skipped the leading
    // zeros would quietly be a 900,000-code space, not a million.
    for (let i = 0; i < 2000; i += 1) {
      expect(generateImpersonationOtp()).toMatch(/^[0-9]{6}$/);
    }
  });

  it('does not repeat itself over a reasonable sample', () => {
    // A constant or a near-constant would pass every other test in this
    // file while making the code guessable, which is the one property
    // that matters.
    const seen = new Set(Array.from({ length: 500 }, () => generateImpersonationOtp()));
    expect(seen.size).toBeGreaterThan(400);
  });

  it('reaches both ends of the space', () => {
    // Enough samples that a generator stuck in the middle of the range
    // shows up. If this ever flakes, that is the finding.
    const codes = Array.from({ length: 5000 }, () => Number(generateImpersonationOtp()));
    expect(Math.min(...codes)).toBeLessThan(100_000);
    expect(Math.max(...codes)).toBeGreaterThan(900_000);
  });
});

describe('isWellFormedOtp', () => {
  it('accepts six digits and nothing else', () => {
    expect(isWellFormedOtp('000000')).toBe(true);
    expect(isWellFormedOtp('123456')).toBe(true);
  });

  it('rejects the shapes a caller might actually send', () => {
    // Whitespace and separators are the ones a person types; the rest
    // are what a script sends. None of them is a guess, and letting any
    // of them reach the store would be a comparison against something
    // that is not a code.
    for (const bad of [
      '',
      '12345',
      '1234567',
      '12345a',
      ' 123456',
      '123456 ',
      '123 456',
      '123-456',
      '+12345',
      '1e5',
      '０１２３４５',
      '\n123456',
    ]) {
      expect(isWellFormedOtp(bad)).toBe(false);
    }
  });
});

describe('ImpersonationOtpService.issue', () => {
  it('never returns the code — only the deadline', async () => {
    const { svc, mails } = makeSut();
    const result = await svc.issue(issueInput());

    // The returned shape is the whole API surface the controller sees.
    // Anything else on it would reach the browser of whoever is already
    // holding the console, which is the person this step exists to stop.
    expect(Object.keys(result)).toEqual(['otpExpiresAt']);
    expect(JSON.stringify(result)).not.toContain(mailedCode(mails));
  });

  it('mails the plaintext to the STAFF member, never to the seller', async () => {
    // The code is proof of who is at the keyboard, not the seller's
    // consent. Asking a seller to read out a code would be a
    // social-engineering lesson we taught them ourselves.
    const { svc, mails } = makeSut();
    await svc.issue(issueInput());

    expect(mails).toHaveLength(1);
    expect(mails[0]!.recipient.email).toBe('support@example.com');
    expect(mails[0]!.recipient.id).toBe(STAFF_ID);
    expect(mails[0]!.recipient.type).toBe('STAFF');
  });

  it('tells the staff member what they are about to be inside, and on what terms', async () => {
    // A code with no context is a code somebody approves reflexively.
    // The mail has to be readable as "you are about to enter THIS
    // account, with THIS access, for THIS reason".
    const { svc, mails } = makeSut();
    await svc.issue(issueInput({ mayWrite: true }));

    expect(mails[0]!.variables).toMatchObject({
      staff_name: 'Asha',
      subject_label: 'Kalpana Textiles (seller)',
      access: 'read and write',
      reason: 'checking a payout they say is missing',
      expires_minutes: String(IMPERSONATION_OTP_TTL_MINUTES),
    });
  });

  it('tells them how long the CODE lives and how long the SESSION lives', async () => {
    // Two different promises, and conflating them is how somebody
    // assumes they have half an hour to type six digits. The code dies
    // in ten minutes whether it is used or not; the session dies on its
    // own deadline whether it is finished with or not.
    const { svc, mails } = makeSut();
    await svc.issue(issueInput({ expiresAt: new Date(Date.now() + 30 * 60 * 1000) }));

    expect(mails[0]!.variables).toMatchObject({
      expires_minutes: String(IMPERSONATION_OTP_TTL_MINUTES),
      session_minutes: '30',
    });
  });

  it('says read-only when the session is read-only', async () => {
    const { svc, mails } = makeSut();
    await svc.issue(issueInput({ mayWrite: false }));
    expect(mails[0]!.variables).toMatchObject({ access: 'read-only' });
  });

  it('stores only the hash — the plaintext is nowhere in Redis', async () => {
    /*
      Six digits is not a serious obstacle to anybody holding the hash,
      and the docblock says so. What the hash buys is that the LIVE code
      is not sitting in plaintext in a store that gets dumped into bug
      reports, read off a `KEYS` over somebody's shoulder, or scraped by
      a `MONITOR`.
    */
    const { svc, redis, mails, codeKey } = makeSut();
    await svc.issue(issueInput());
    const code = mailedCode(mails);

    const stored = await redis.get(codeKey);
    expect(stored).toBe(new TokenHashService().sha256Hex(code));
    expect(stored).not.toBe(code);
    expect(stored).toMatch(/^[0-9a-f]{64}$/);

    for (const [key, value] of redis.snapshot()) {
      expect(key).not.toContain(code);
      expect(value).not.toContain(code);
    }
  });

  it('never writes the code to a log, on any channel', async () => {
    const { svc, mails, logged } = makeSut();
    await svc.issue(issueInput());
    const code = mailedCode(mails);

    expect(logged.length).toBeGreaterThan(0); // the issue IS logged…
    for (const args of logged) {
      expect(JSON.stringify(args)).not.toContain(code); // …without the code.
    }
  });

  it('logs enough to be useful: the session and the staff member', async () => {
    const { svc, logged } = makeSut();
    await svc.issue(issueInput());

    const all = JSON.stringify(logged);
    expect(all).toContain(SESSION_ID);
    expect(all).toContain(STAFF_ID);
  });

  it('gives the code a ten-minute life, in Redis and in the returned deadline', async () => {
    const { svc, redis, codeKey } = makeSut();
    const before = Date.now();
    const { otpExpiresAt } = await svc.issue(issueInput());

    expect(redis.ttlOf(codeKey)).toBe(IMPERSONATION_OTP_TTL_MINUTES * 60);
    // The deadline the caller is handed has to agree with the store, or
    // the UI counts down to a moment the code is already dead past.
    const expectedMs = before + IMPERSONATION_OTP_TTL_MINUTES * 60 * 1000;
    expect(Math.abs(otpExpiresAt.getTime() - expectedMs)).toBeLessThan(2000);
  });

  it('a fresh code starts a fresh count', async () => {
    // Four bad guesses, then a new session's code. Carrying the stale
    // counter over would lock out a session nobody had guessed at.
    const { svc, redis, failKey } = makeSut();
    await svc.issue(issueInput());
    for (let i = 0; i < 4; i += 1) await svc.check(SESSION_ID, '000001');
    expect(await redis.get(failKey)).toBe('4');

    await svc.issue(issueInput());
    expect(await redis.get(failKey)).toBeNull();
  });
});

describe('ImpersonationOtpService.check — single use', () => {
  it('a correct code verifies once', async () => {
    const { svc, mails } = makeSut();
    await svc.issue(issueInput());

    expect(await svc.check(SESSION_ID, mailedCode(mails))).toEqual({ ok: true });
  });

  it('the same correct code does NOT verify a second time', async () => {
    /*
      The failure this prevents: a support mail forwarded to a shared
      inbox, or a code screenshotted into a ticket. Once the real owner
      has used it, the digits have to be dead — otherwise the second
      factor is a password with a short name.
    */
    const { svc, mails } = makeSut();
    await svc.issue(issueInput());
    const code = mailedCode(mails);

    expect(await svc.check(SESSION_ID, code)).toEqual({ ok: true });
    const second = await svc.check(SESSION_ID, code);
    expect(second.ok).toBe(false);
    expect(second).toMatchObject({ refusal: 'NO_LIVE_CODE' });
  });

  it('a verified code leaves nothing behind in Redis', async () => {
    const { svc, redis, mails, codeKey, failKey } = makeSut();
    await svc.issue(issueInput());
    await svc.check(SESSION_ID, mailedCode(mails));

    expect(await redis.get(codeKey)).toBeNull();
    expect(await redis.get(failKey)).toBeNull();
  });

  it('a code is bound to its own session', async () => {
    // Two sessions in flight, each with its own code. A code that
    // worked in the wrong session would mean one approval let a staff
    // member into an account they were never approved for.
    const other = '0190d4e1-33cc-7def-8023-4b5c6d7e8f99';
    const { svc, mails } = makeSut();
    await svc.issue(issueInput());
    await svc.issue(issueInput({ sessionId: other }));
    const [first, second] = [mails[0]!.variables!['code'], mails[1]!.variables!['code']];

    // Both codes exist; neither opens the other's session unless they
    // happen to collide, which the guard below rules out.
    if (first !== second) {
      expect(await svc.check(other, first as string)).toMatchObject({ ok: false });
    }
    expect(await svc.check(other, second as string)).toEqual({ ok: true });
  });

  it('revoke kills a code that was mailed for an abandoned session', async () => {
    const { svc, mails } = makeSut();
    await svc.issue(issueInput());
    const code = mailedCode(mails);

    await svc.revoke(SESSION_ID);
    expect(await svc.check(SESSION_ID, code)).toMatchObject({
      ok: false,
      refusal: 'NO_LIVE_CODE',
    });
  });
});

describe('ImpersonationOtpService.check — expiry', () => {
  it('refuses a code once its ten minutes are up', async () => {
    const { svc, redis, mails } = makeSut();
    await svc.issue(issueInput());
    const code = mailedCode(mails);

    redis.advanceMinutes(IMPERSONATION_OTP_TTL_MINUTES + 1);
    expect(await svc.check(SESSION_ID, code)).toMatchObject({
      ok: false,
      refusal: 'NO_LIVE_CODE',
    });
  });

  it('still accepts it a minute before the deadline', async () => {
    // The other half: an expiry that fired early would have staff
    // re-requesting codes constantly and reaching for a longer TTL.
    const { svc, redis, mails } = makeSut();
    await svc.issue(issueInput());
    const code = mailedCode(mails);

    redis.advanceMinutes(IMPERSONATION_OTP_TTL_MINUTES - 1);
    expect(await svc.check(SESSION_ID, code)).toEqual({ ok: true });
  });

  it('an expired code is NO_LIVE_CODE, not MISMATCH', async () => {
    // The two say different things to the staff member: one means "ask
    // for another", the other means "you typed it wrong". Collapsing
    // them has somebody burning their guesses on a dead code.
    const { svc, redis, mails } = makeSut();
    await svc.issue(issueInput());
    const code = mailedCode(mails);
    redis.advanceMinutes(IMPERSONATION_OTP_TTL_MINUTES + 1);

    const result = await svc.check(SESSION_ID, code);
    expect(result).toMatchObject({ refusal: 'NO_LIVE_CODE' });
  });

  it('the failure counter outlives the code', async () => {
    /*
      If the count expired with the code, waiting ten minutes and asking
      again would reset the guesses for free — and that is a brute force
      with a sleep in it, which is still a brute force.
    */
    const { svc, redis, failKey } = makeSut();
    await svc.issue(issueInput());
    await svc.check(SESSION_ID, '000001');

    const codeTtl = IMPERSONATION_OTP_TTL_MINUTES * 60;
    expect(redis.ttlOf(failKey)).toBeGreaterThan(codeTtl);
  });

  it('the counter TTL is set once and not pushed forward by each guess', async () => {
    // Re-setting the expiry on every attempt would let a patient
    // attacker hold the window open indefinitely.
    const { svc, redis, failKey } = makeSut();
    await svc.issue(issueInput());
    await svc.check(SESSION_ID, '000001');
    const firstDeadline = redis.now + redis.ttlOf(failKey)!;

    redis.advanceMinutes(5);
    await svc.check(SESSION_ID, '000002');
    expect(redis.now + redis.ttlOf(failKey)!).toBe(firstDeadline);
  });

  it('the counter never lingers without a TTL', async () => {
    // `INCR` on a missing key creates it with no expiry, which would
    // leave the counter in Redis for ever and lock the session out of
    // a retry nobody remembers refusing.
    const { svc, redis, failKey } = makeSut();
    await svc.issue(issueInput());
    await svc.check(SESSION_ID, '000001');
    expect(redis.ttlOf(failKey)).toBeDefined();
  });
});

describe('ImpersonationOtpService.check — the attempt cap', () => {
  it('allows exactly five guesses, and the sixth is refused outright', async () => {
    /*
      Five guesses against a million codes is one chance in two hundred
      thousand. The sixth guess does not get to happen — and because the
      counter is keyed on the SESSION, re-requesting means a new session
      row and a second `requested` line in the audit log, which is
      exactly the trail a brute force would rather not leave.
    */
    const { svc } = makeSut();
    await svc.issue(issueInput());

    for (let guess = 1; guess <= MAX_IMPERSONATION_OTP_ATTEMPTS; guess += 1) {
      const result = await svc.check(SESSION_ID, '000001');
      expect(result.ok).toBe(false);
      // Each wrong guess is counted, and the caller is told what is
      // left so the UI can warn before the session dies.
      expect(result).toMatchObject({ attemptsLeft: MAX_IMPERSONATION_OTP_ATTEMPTS - guess });
    }

    expect(await svc.check(SESSION_ID, '000001')).toEqual({
      ok: false,
      refusal: 'ATTEMPTS_EXHAUSTED',
      attemptsLeft: 0,
    });
  });

  it('once exhausted, even the CORRECT code is refused', async () => {
    // The security property, and the one that has to hold however the
    // refusal is labelled: the attacker who would have guessed it on
    // try six does not get in.
    const { svc, mails } = makeSut();
    await svc.issue(issueInput());
    const code = mailedCode(mails);

    for (let i = 0; i < MAX_IMPERSONATION_OTP_ATTEMPTS + 1; i += 1) {
      await svc.check(SESSION_ID, '000001');
    }

    expect((await svc.check(SESSION_ID, code)).ok).toBe(false);
  });

  it('the fifth wrong guess that reports ATTEMPTS_EXHAUSTED also kills the code', async () => {
    /*
      ── FAILING: the cap is announced before it is applied ────────────

      On the fifth wrong guess `attemptsLeft` reaches 0, so `check`
      returns `ATTEMPTS_EXHAUSTED` — but it takes the MISMATCH branch,
      which does not call `revoke`. The only branch that revokes is the
      `attempts > MAX` one, reached on a SIXTH call that may never come.

      So the service tells its caller the guesses are gone while the
      code is still live in Redis. Whether that matters depends entirely
      on the lifecycle layer calling `revoke` when it sees the refusal —
      which is a promise this service makes on somebody else's behalf,
      and the kind of promise that is kept until the day a handler
      returns early.
    */
    const { svc, redis, codeKey } = makeSut();
    await svc.issue(issueInput());

    // Exactly five wrong guesses, no more. The fifth is the one that
    // reports the cap as spent.
    let last;
    for (let i = 0; i < MAX_IMPERSONATION_OTP_ATTEMPTS; i += 1) {
      last = await svc.check(SESSION_ID, '000001');
    }
    expect(last).toMatchObject({ refusal: 'ATTEMPTS_EXHAUSTED', attemptsLeft: 0 });

    // Having said that, the code must be gone.
    expect(await redis.get(codeKey)).toBeNull();
  });

  it('the exhausted state is sticky — the counter is not reset by reaching it', async () => {
    /*
      ── FAILING: `revoke` deletes the counter it was meant to outlive ─

      The service's own docblock: "The failure counter outlives the code
      on purpose. If it expired with the code, waiting ten minutes and
      asking again would reset the count for free."

      `revoke` deletes BOTH keys — `del(codeKey(id), failKey(id))` — and
      the exhaustion branch calls `revoke`. So the sixth guess, the one
      that trips the cap, also zeroes the counter that tripped it. The
      seventh guess is counted as attempt 1 again and comes back
      `NO_LIVE_CODE` with four attempts remaining.

      Nobody gets in, because the code went with it. What is lost is the
      SIGNAL: `ATTEMPTS_EXHAUSTED` is visible exactly once, and a
      lifecycle layer that polls, retries, or simply arrives a request
      late sees "no live code" — indistinguishable from an ordinary
      expiry — and never ends the session it was supposed to end.
    */
    const { svc } = makeSut();
    await svc.issue(issueInput());

    for (let i = 0; i < MAX_IMPERSONATION_OTP_ATTEMPTS + 1; i += 1) {
      await svc.check(SESSION_ID, '000001');
    }

    // Asked again, the answer must still be "the guesses are gone".
    expect(await svc.check(SESSION_ID, '000001')).toEqual({
      ok: false,
      refusal: 'ATTEMPTS_EXHAUSTED',
      attemptsLeft: 0,
    });
  });

  it('a malformed guess still costs an attempt', async () => {
    // Otherwise the cap is free to bypass: send junk until the counter
    // is irrelevant, then start guessing. Counting the attempt before
    // looking at the shape is the correct order.
    const { svc } = makeSut();
    await svc.issue(issueInput());

    const first = await svc.check(SESSION_ID, 'abc');
    expect(first).toMatchObject({
      refusal: 'MISMATCH',
      attemptsLeft: MAX_IMPERSONATION_OTP_ATTEMPTS - 1,
    });
  });

  it('a guess against a session that never had a code still costs an attempt', async () => {
    // Nothing was issued. The cap still has to bite, or the counter is
    // something an attacker can choose not to start.
    const { svc } = makeSut();
    const result = await svc.check(SESSION_ID, '000001');
    expect(result).toMatchObject({
      refusal: 'NO_LIVE_CODE',
      attemptsLeft: MAX_IMPERSONATION_OTP_ATTEMPTS - 1,
    });
  });

  it('a correct guess does not spend the whole budget first', async () => {
    // One wrong digit, then the right code. The staff member who
    // fat-fingers the first attempt must not be locked out.
    const { svc, mails } = makeSut();
    await svc.issue(issueInput());
    await svc.check(SESSION_ID, '000001');

    expect(await svc.check(SESSION_ID, mailedCode(mails))).toEqual({ ok: true });
  });

  it('attemptsLeft is never negative', async () => {
    // It is shown to a person. "-3 attempts remaining" is a number
    // nobody can act on.
    const { svc } = makeSut();
    await svc.issue(issueInput());
    for (let i = 0; i < MAX_IMPERSONATION_OTP_ATTEMPTS + 5; i += 1) {
      const result = await svc.check(SESSION_ID, '000001');
      if (!result.ok) expect(result.attemptsLeft).toBeGreaterThanOrEqual(0);
    }
  });

  it('no refusal result ever carries the code or its hash', async () => {
    // A refusal is the response an attacker sees most often, so it is
    // the worst place to leak anything about the code.
    const { svc, mails } = makeSut();
    await svc.issue(issueInput());
    const code = mailedCode(mails);
    const hash = new TokenHashService().sha256Hex(code);

    const result = await svc.check(SESSION_ID, '000001');
    const serialised = JSON.stringify(result);
    expect(serialised).not.toContain(code);
    expect(serialised).not.toContain(hash);
  });
});
