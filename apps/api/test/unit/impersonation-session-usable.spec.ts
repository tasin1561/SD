import { UnauthorizedException } from '@nestjs/common';
import {
  assertUsable,
  isUsable,
  type UsableImpersonationSession,
} from '../../src/modules/impersonation/services/impersonation.service';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * "May this session still be used?" asked of every single request.
 *
 * ── WHY THIS TEST EXISTS ─────────────────────────────────────────────
 * The cookie is only a POINTER at the session row. The row is the
 * authority, re-read and re-judged every request, because a support
 * session is endable by somebody ELSE: an admin watching the review
 * screen ends one while it is running, and that has to bite on the next
 * request rather than whenever a cookie happens to expire. Everything
 * that makes ending a session meaningful lives in this one function.
 *
 * ── THE THREE DEAD STATES, AND WHICH ONE GETS DROPPED ────────────────
 * Expired, ended, never-verified. The third is the one a refactor loses,
 * for two reasons: it is the only clause that is not about time, and an
 * unverified row looks completely ordinary — the row is created when the
 * OTP is SENT, precisely so an abandoned attempt stays visible to a
 * reviewer. So unverified rows are a normal thing to find in the table,
 * and treating their existence as permission would hand a live session
 * to whoever got as far as asking for a code and no further.
 *
 * ── WHY IT THROWS INSTEAD OF RETURNING A BOOLEAN ─────────────────────
 * Four callers have to ask: redeeming the handoff, every guarded request
 * after it, ending a session, and the review screen. A boolean is
 * something a caller can forget to act on; a thrown 401 is not. The
 * tests below therefore assert on the throw, not on a return value.
 */

const FUTURE = new Date('2026-10-07T13:00:00.000Z');
const NOW = new Date('2026-10-07T12:00:00.000Z');
const PAST = new Date('2026-10-07T11:00:00.000Z');

function session(overrides: Partial<UsableImpersonationSession> = {}): UsableImpersonationSession {
  return {
    id: '0190d4e1-11aa-7bcd-8e01-2f3a4b5c6d77',
    otpVerifiedAt: new Date('2026-10-07T11:55:00.000Z'),
    expiresAt: FUTURE,
    endedAt: null,
    endedReason: null,
    ...overrides,
  };
}

/** The refusal body, which is what a client actually receives. */
function refusalOf(fn: () => void): { code?: string; message?: string } {
  try {
    fn();
  } catch (err) {
    expect(err).toBeInstanceOf(UnauthorizedException);
    return (err as UnauthorizedException).getResponse() as { code?: string; message?: string };
  }
  throw new Error('expected the session to be refused, and it was not');
}

describe('assertUsable: a live session', () => {
  it('passes when it is verified, not ended, and inside its deadline', () => {
    // The ordinary case. If this threw, the whole feature would be
    // unreachable and somebody would be tempted to loosen a clause.
    expect(() => assertUsable(session(), NOW)).not.toThrow();
    expect(isUsable(session(), NOW)).toBe(true);
  });

  it('passes right up to the deadline', () => {
    expect(() =>
      assertUsable(session({ expiresAt: new Date(NOW.getTime() + 1) }), NOW),
    ).not.toThrow();
  });
});

describe('assertUsable: expired', () => {
  it('refuses a session past its deadline', () => {
    // There is no reaper job and there does not need to be: `expiresAt`
    // in the past IS expired, because this function is consulted every
    // request. A session cannot outlive its deadline merely because a
    // cron did not run.
    const refusal = refusalOf(() => assertUsable(session({ expiresAt: PAST }), NOW));
    expect(refusal.code).toBe('IMPERSONATION_SESSION_EXPIRED');
    expect(isUsable(session({ expiresAt: PAST }), NOW)).toBe(false);
  });

  it('refuses it exactly ON the deadline, not a millisecond after', () => {
    // `<=` and not `<`. A session that is usable at the instant it
    // expires is a session whose deadline is advisory.
    expect(isUsable(session({ expiresAt: NOW }), NOW)).toBe(false);
  });

  it('is refused even though endedAt is still null', () => {
    /*
      "It ran out" and "somebody closed it" are different facts, and
      `endedAt` is deliberately left null on an expired session so a
      reviewer can tell them apart. That means expiry cannot be checked
      by looking at `endedAt` — which is exactly the shortcut a
      refactor would take.
    */
    const expired = session({ expiresAt: PAST, endedAt: null });
    expect(expired.endedAt).toBeNull();
    expect(isUsable(expired, NOW)).toBe(false);
  });

  it('says it is over and that a new one is needed, not that access was denied', () => {
    // The staff member's next action is "open another session with a
    // reason". A bare 401 sends them to ask somebody why they are
    // locked out.
    const refusal = refusalOf(() => assertUsable(session({ expiresAt: PAST }), NOW));
    expect(refusal.message).toMatch(/run out|expired/i);
    expect(refusal.message!.trim().endsWith('.')).toBe(true);
  });
});

describe('assertUsable: ended', () => {
  it('refuses a session an admin ended', () => {
    // This is the clause that makes the review screen's "end session"
    // button a control rather than a gesture.
    const refusal = refusalOf(() =>
      assertUsable(session({ endedAt: new Date('2026-10-07T11:58:00.000Z') }), NOW),
    );
    expect(refusal.code).toBe('IMPERSONATION_SESSION_ENDED');
  });

  it('refuses it even though the deadline has not passed', () => {
    // The whole point: ending has to take effect before expiry would
    // have, or ending one early achieves nothing.
    const ended = session({ endedAt: PAST, expiresAt: FUTURE });
    expect(ended.expiresAt.getTime()).toBeGreaterThan(NOW.getTime());
    expect(isUsable(ended, NOW)).toBe(false);
  });

  it('quotes the reason it was ended, when there is one', () => {
    // A staff member cut off mid-session deserves to know why, and the
    // reason is already on the row.
    const refusal = refusalOf(() =>
      assertUsable(session({ endedAt: PAST, endedReason: 'ended by an admin during review' }), NOW),
    );
    expect(refusal.message).toContain('ended by an admin during review');
  });

  it('still refuses when no reason was recorded', () => {
    // A missing reason must not be read as a missing end.
    const refusal = refusalOf(() =>
      assertUsable(session({ endedAt: PAST, endedReason: null }), NOW),
    );
    expect(refusal.code).toBe('IMPERSONATION_SESSION_ENDED');
    expect(refusal.message).toMatch(/ended/i);
  });
});

describe('assertUsable: never OTP-verified', () => {
  it('refuses a session that never cleared its code', () => {
    /*
      The row exists from the moment the code is SENT, so an unverified
      row is an ordinary thing to find. Reading its existence as
      permission would give a session to whoever asked for a code and
      then stopped — including somebody who asked using a stolen admin
      console and never had access to the mailbox, which is the one
      attacker this whole second factor is aimed at.
    */
    const refusal = refusalOf(() => assertUsable(session({ otpVerifiedAt: null }), NOW));
    expect(refusal.code).toBe('IMPERSONATION_NOT_VERIFIED');
    expect(isUsable(session({ otpVerifiedAt: null }), NOW)).toBe(false);
  });

  it('refuses it even when everything about the timing is fine', () => {
    // Not expired, not ended, inside its window. The ONLY thing wrong
    // is the clause that is not about time, and that has to be enough.
    const unverified = session({ otpVerifiedAt: null, endedAt: null, expiresAt: FUTURE });
    expect(isUsable(unverified, NOW)).toBe(false);
  });

  it('says the code has not been cleared, so the next action is obvious', () => {
    const refusal = refusalOf(() => assertUsable(session({ otpVerifiedAt: null }), NOW));
    expect(refusal.message).toMatch(/code/i);
  });
});

describe('assertUsable: more than one thing wrong', () => {
  it('refuses a session that is expired AND unverified', () => {
    expect(isUsable(session({ otpVerifiedAt: null, expiresAt: PAST }), NOW)).toBe(false);
  });

  it('refuses a session that is ended AND unverified', () => {
    // The abandoned attempt somebody then tidied up. Two reasons to
    // refuse is still a refusal.
    expect(isUsable(session({ otpVerifiedAt: null, endedAt: PAST }), NOW)).toBe(false);
  });

  it('refuses every combination of the three dead states', () => {
    /*
      Exhaustive over the eight combinations, because the clauses are a
      chain of early returns and a reordering that let one combination
      through would be invisible in any single-fault test.
    */
    for (const verified of [true, false]) {
      for (const ended of [true, false]) {
        for (const expired of [true, false]) {
          const row = session({
            otpVerifiedAt: verified ? new Date('2026-10-07T11:55:00.000Z') : null,
            endedAt: ended ? PAST : null,
            expiresAt: expired ? PAST : FUTURE,
          });
          const shouldBeUsable = verified && !ended && !expired;
          expect(isUsable(row, NOW)).toBe(shouldBeUsable);
        }
      }
    }
  });

  it('every refusal carries a code and a sentence', () => {
    // Both halves are used: the code is what a client branches on, the
    // sentence is what a person reads.
    for (const overrides of [
      { otpVerifiedAt: null },
      { endedAt: PAST },
      { expiresAt: PAST },
      { otpVerifiedAt: null, endedAt: PAST, expiresAt: PAST },
    ] as Array<Partial<UsableImpersonationSession>>) {
      const refusal = refusalOf(() => assertUsable(session(overrides), NOW));
      expect(typeof refusal.code).toBe('string');
      expect(refusal.code).toMatch(/^IMPERSONATION_/);
      expect(refusal.message!.trim().length).toBeGreaterThan(0);
      expect(refusal.message!.trim().endsWith('.')).toBe(true);
    }
  });
});

describe('assertUsable: the clock is a parameter', () => {
  it('a session dead at one instant is alive at an earlier one', () => {
    // `now` is injectable so a test can sit either side of a deadline
    // without sleeping — and so a reviewer can ask "was this live at
    // 14:02?" without time travel.
    const row = session({ expiresAt: new Date('2026-10-07T12:30:00.000Z') });
    expect(isUsable(row, new Date('2026-10-07T12:29:59.000Z'))).toBe(true);
    expect(isUsable(row, new Date('2026-10-07T12:30:01.000Z'))).toBe(false);
  });

  it('defaults to the real clock', () => {
    expect(isUsable(session({ expiresAt: new Date(Date.now() + 60_000) }))).toBe(true);
    expect(isUsable(session({ expiresAt: new Date(Date.now() - 60_000) }))).toBe(false);
  });
});

describe('there is only ONE usability authority', () => {
  /*
    ── WHY A SOURCE TEST, AND WHAT IT ALREADY CAUGHT ─────────────────

    For part of this build there were TWO `assertUsable`s: this one, and
    a copy at `src/common/impersonation/impersonation-session-usable.ts`
    written so the guards would have something to call before the
    service landed. The copy's own docblock said why that was dangerous:

        "Do not add a second usability test anywhere; two of them is how
         a session stays usable after it was ended."

    And the two had already drifted. The service raises three distinct
    codes (`IMPERSONATION_SESSION_ENDED` / `_NOT_VERIFIED` /
    `_SESSION_EXPIRED`); the copy raised one
    (`IMPERSONATION_SESSION_UNUSABLE`) for all three. Worse, they checked
    the clauses in different ORDERS — ended → verified → expired against
    verified → ended → expired — so for the commonest dead row in the
    table, an attempt abandoned before verification and later tidied up,
    they told the staff member two different stories.

    The copy has since been removed and the service's is the only one
    left. This test is what stops the second copy coming back, because
    the next person who needs a usability check before their dependency
    lands will reach for exactly the same shortcut.
  */
  const SRC = join(__dirname, '../../src');

  function tsFiles(dir: string, out: string[] = []): string[] {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) tsFiles(full, out);
      else if (entry.name.endsWith('.ts')) out.push(full);
    }
    return out;
  }

  it('exactly one file defines assertUsable', () => {
    const definers = tsFiles(SRC).filter((f) =>
      /export (?:function|const) assertUsable\b/.test(readFileSync(f, 'utf8')),
    );

    expect(definers.map((f) => f.slice(SRC.length))).toEqual([
      '/modules/impersonation/services/impersonation.service.ts',
    ]);
  });

  it('no other file re-implements the three clauses', () => {
    /*
      A second implementation does not have to be called `assertUsable`
      to be a second implementation. What makes one is reading all three
      fields and deciding — so any file that touches `otpVerifiedAt` and
      `endedAt` and `expiresAt` together is either the authority or a
      copy of it.

      `impersonation-session-loader.service.ts` is allowed because it
      SELECTS those columns to hand to the authority; it must not judge
      them. If it ever starts judging them, that is the drift this test
      exists to stop, and the fix is to delete its copy, not to widen
      this list.
    */
    const ALLOWED = [
      '/modules/impersonation/services/impersonation.service.ts',
      '/common/impersonation/impersonation-session-loader.service.ts',
    ];

    const suspects = tsFiles(SRC).filter((f) => {
      const src = readFileSync(f, 'utf8');
      return src.includes('otpVerifiedAt') && src.includes('endedAt') && src.includes('expiresAt');
    });

    for (const file of suspects) {
      const rel = file.slice(SRC.length);
      if (ALLOWED.includes(rel)) continue;
      // Reading the fields is fine. Throwing on them is not.
      const src = readFileSync(file, 'utf8');
      expect(src).not.toMatch(/otpVerifiedAt\s*===\s*null[\s\S]{0,200}throw/);
    }
  });
});
