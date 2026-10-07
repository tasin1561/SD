import {
  currentImpersonation,
  runImpersonated,
  type ImpersonationContext,
} from '../../src/common/impersonation/impersonation-context';

/**
 * The audit stamping has no other source of truth than this.
 *
 * ── WHY THIS TEST EXISTS ─────────────────────────────────────────────
 * `AuditLogService.log` is called from roughly two hundred places and
 * none of them passes "a staff member was impersonating". The guard puts
 * it here once and the audit writer reads it back, which means every
 * impersonated audit row in the system depends on `currentImpersonation`
 * returning the right answer at a point in the call stack arbitrarily
 * far from where `runImpersonated` was entered.
 *
 * `audit_logs` is append-only. A row that says the SELLER did something
 * a staff member did cannot be corrected afterwards — so the failure
 * mode here is silent, permanent, and only discovered when somebody
 * disputes an order six months later.
 *
 * ── WHY THE ASYNC CASES ARE THE POINT ────────────────────────────────
 * AsyncLocalStorage was chosen over a plain module-level variable for
 * exactly one reason: it crosses `await`. A module-level variable passes
 * the first two tests in this file and fails every one after them, and
 * it fails them by LEAKING — request A's staff id stamped onto request
 * B's audit row, which is a worse row than no row at all. The
 * concurrency tests below are the ones that tell the two apart, so they
 * interleave deliberately rather than running one session to completion
 * before starting the next.
 */

function ctx(overrides: Partial<ImpersonationContext> = {}): ImpersonationContext {
  return {
    sessionId: 'session-1',
    staffUserId: 'staff-1',
    subject: { kind: 'SELLER', id: 'seller-1' },
    mayWrite: false,
    ...overrides,
  };
}

/** A real macrotask boundary, not a microtask. */
const tick = (ms = 0): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

describe('impersonation context', () => {
  describe('outside any session', () => {
    it('is null — the overwhelmingly common case', () => {
      // A real seller, a real store user, a staff member on their own
      // console, or a cron. If this ever returned a stale context, every
      // ordinary audit row would claim it was impersonated.
      expect(currentImpersonation()).toBeNull();
    });

    it('is null inside an async function with no session', () => {
      return (async () => {
        await tick();
        expect(currentImpersonation()).toBeNull();
      })();
    });

    it('is null in a queue worker, which has no request at all', async () => {
      // Nobody is impersonating a cron, and null is the truthful answer
      // rather than an absence the caller has to interpret.
      await Promise.all([tick(1), tick(0)]);
      expect(currentImpersonation()).toBeNull();
    });
  });

  describe('inside runImpersonated', () => {
    it('is the context that was passed in', () => {
      const given = ctx();
      runImpersonated(given, () => {
        expect(currentImpersonation()).toEqual(given);
      });
    });

    it('carries every field the audit writer reads', () => {
      const given = ctx({
        sessionId: 'session-7',
        staffUserId: 'staff-7',
        subject: { kind: 'STORE', id: 'store-7' },
        mayWrite: true,
      });
      runImpersonated(given, () => {
        const seen = currentImpersonation();
        expect(seen?.sessionId).toBe('session-7');
        expect(seen?.staffUserId).toBe('staff-7');
        expect(seen?.subject).toEqual({ kind: 'STORE', id: 'store-7' });
        expect(seen?.mayWrite).toBe(true);
      });
    });

    it('returns whatever the callback returned', () => {
      // The guard wraps the rest of the request in this, so swallowing
      // the handler's return value would break every impersonated
      // response body.
      expect(runImpersonated(ctx(), () => 'handler-result')).toBe('handler-result');
    });

    it('lets the callback throw, with the error unchanged', async () => {
      // A refused request throws out of the handler. If this helper
      // caught anything, a forbidden action would look like it
      // succeeded.
      const boom = new Error('refused');
      expect(() =>
        runImpersonated(ctx(), () => {
          throw boom;
        }),
      ).toThrow(boom);

      await expect(
        runImpersonated(ctx(), async () => {
          await tick();
          throw boom;
        }),
      ).rejects.toBe(boom);
    });
  });

  describe('it survives await boundaries', () => {
    /*
      This is the whole reason AsyncLocalStorage was chosen. The audit
      write sits several awaits deep inside a service, behind database
      calls and often behind a Promise.all — nowhere near the guard that
      opened the session.
    */
    it('survives a plain await', async () => {
      await runImpersonated(ctx({ staffUserId: 'staff-await' }), async () => {
        await tick();
        expect(currentImpersonation()?.staffUserId).toBe('staff-await');
      });
    });

    it('survives a deep chain of awaits', async () => {
      const deep = async (depth: number): Promise<string | undefined> => {
        await tick();
        if (depth === 0) return currentImpersonation()?.staffUserId;
        return deep(depth - 1);
      };

      const seen = await runImpersonated(ctx({ staffUserId: 'staff-deep' }), () => deep(8));
      expect(seen).toBe('staff-deep');
    });

    it('survives inside every branch of a Promise.all', async () => {
      // A service that fans out — reads the order, reads the wallet,
      // writes the audit row — does it like this. Each branch runs on
      // its own async resource and each one has to see the session.
      await runImpersonated(ctx({ staffUserId: 'staff-all' }), async () => {
        const seen = await Promise.all([
          (async () => {
            await tick(2);
            return currentImpersonation()?.staffUserId;
          })(),
          (async () => {
            await tick(0);
            return currentImpersonation()?.staffUserId;
          })(),
          (async () => {
            await Promise.resolve();
            return currentImpersonation()?.staffUserId;
          })(),
        ]);

        expect(seen).toEqual(['staff-all', 'staff-all', 'staff-all']);
      });
    });

    it('survives a setTimeout-based tick', async () => {
      // A macrotask is a harder case than an await: the stack is gone
      // and only the async resource's stored context remains.
      const seen = await runImpersonated(
        ctx({ staffUserId: 'staff-timer' }),
        () =>
          new Promise<string | undefined>((resolve) => {
            setTimeout(() => resolve(currentImpersonation()?.staffUserId), 1);
          }),
      );
      expect(seen).toBe('staff-timer');
    });

    it('survives into a callback that runs AFTER the session call returned', async () => {
      /*
        Audit writes are frequently fire-and-forget — the handler does
        not await them, so the insert happens after the guard's wrapper
        has already handed control back. If the context did not travel
        with the scheduled work, exactly those rows would lose their
        impersonator, and they are the ones nobody is watching.
      */
      let seen: string | null | undefined;
      const written = new Promise<void>((resolve) => {
        runImpersonated(ctx({ staffUserId: 'staff-detached' }), () => {
          setTimeout(() => {
            seen = currentImpersonation()?.staffUserId ?? null;
            resolve();
          }, 1);
        });
      });

      // The synchronous callback has returned; the audit write has not.
      expect(currentImpersonation()).toBeNull();
      await written;
      expect(seen).toBe('staff-detached');
    });
  });

  describe('two concurrent sessions do not leak into each other', () => {
    it('each sees only its own staff member, interleaved', async () => {
      /*
        Two staff members in two support sessions, on the same Node
        process, with their awaits interleaved. This is the test a
        module-level variable fails: the second session's write would
        overwrite the first's, and the first session's audit rows would
        name the wrong staff member — a row that accuses somebody.
      */
      const order: string[] = [];

      const session = (name: string, delay: number): Promise<string[]> =>
        runImpersonated(ctx({ sessionId: name, staffUserId: name }), async () => {
          const seen: string[] = [];
          seen.push(currentImpersonation()!.staffUserId);
          await tick(delay);
          order.push(`${name}:a`);
          seen.push(currentImpersonation()!.staffUserId);
          await tick(delay);
          order.push(`${name}:b`);
          seen.push(currentImpersonation()!.staffUserId);
          await Promise.all([tick(0), tick(delay)]);
          seen.push(currentImpersonation()!.staffUserId);
          return seen;
        });

      const [first, second] = await Promise.all([session('staff-A', 4), session('staff-B', 1)]);

      expect(first).toEqual(['staff-A', 'staff-A', 'staff-A', 'staff-A']);
      expect(second).toEqual(['staff-B', 'staff-B', 'staff-B', 'staff-B']);
      // If they had not actually interleaved, the test above would be
      // proving nothing.
      expect(order).not.toEqual(['staff-A:a', 'staff-A:b', 'staff-B:a', 'staff-B:b']);
    });

    it('a seller session and a store session keep their own subject kind', async () => {
      // The audit writer picks STAFF_AS_SELLER or STAFF_AS_STORE from
      // this field, so a crossed subject writes the wrong actorType
      // into an append-only table.
      const seller = runImpersonated(ctx({ subject: { kind: 'SELLER', id: 's-1' } }), async () => {
        await tick(3);
        return currentImpersonation()!.subject;
      });
      const store = runImpersonated(ctx({ subject: { kind: 'STORE', id: 'st-1' } }), async () => {
        await tick(1);
        return currentImpersonation()!.subject;
      });

      await expect(seller).resolves.toEqual({ kind: 'SELLER', id: 's-1' });
      await expect(store).resolves.toEqual({ kind: 'STORE', id: 'st-1' });
    });

    it('a read-only session running beside a write session stays read-only', async () => {
      // `mayWrite` leaking the wrong way is a write performed by a
      // session that was never granted write access.
      const readOnly = runImpersonated(ctx({ mayWrite: false }), async () => {
        await tick(3);
        return currentImpersonation()!.mayWrite;
      });
      const writable = runImpersonated(ctx({ mayWrite: true }), async () => {
        await tick(1);
        return currentImpersonation()!.mayWrite;
      });

      await expect(readOnly).resolves.toBe(false);
      await expect(writable).resolves.toBe(true);
    });

    it('many sessions at once each keep their own context', async () => {
      const ids = Array.from({ length: 25 }, (_, i) => `staff-${i}`);
      const seen = await Promise.all(
        ids.map((id, i) =>
          runImpersonated(ctx({ staffUserId: id }), async () => {
            await tick(i % 5);
            await Promise.all([tick(0), tick(1)]);
            return currentImpersonation()?.staffUserId;
          }),
        ),
      );
      expect(seen).toEqual(ids);
    });
  });

  describe('it does not leak out of the callback', () => {
    it('is null again immediately after a synchronous session', () => {
      runImpersonated(ctx(), () => undefined);
      expect(currentImpersonation()).toBeNull();
    });

    it('is null again after an async session settles', async () => {
      await runImpersonated(ctx(), async () => {
        await tick();
      });
      expect(currentImpersonation()).toBeNull();
    });

    it('is null again after a session threw', () => {
      // The guard's wrapper has to unwind cleanly. A context left
      // behind by a refused request would stamp the NEXT request's
      // audit rows with a staff member who was no longer there.
      expect(() =>
        runImpersonated(ctx(), () => {
          throw new Error('refused');
        }),
      ).toThrow();
      expect(currentImpersonation()).toBeNull();
    });

    it('work started before the session does not see it', async () => {
      const before = (async () => {
        await tick(2);
        return currentImpersonation();
      })();

      runImpersonated(ctx(), () => undefined);
      await expect(before).resolves.toBeNull();
    });

    it('a nested session shadows the outer one and then restores it', () => {
      // Not a flow we expect, but if it ever happened the inner answer
      // has to be the inner session — silently keeping the outer one
      // would misattribute everything inside.
      runImpersonated(ctx({ staffUserId: 'outer' }), () => {
        expect(currentImpersonation()?.staffUserId).toBe('outer');
        runImpersonated(ctx({ staffUserId: 'inner' }), () => {
          expect(currentImpersonation()?.staffUserId).toBe('inner');
        });
        expect(currentImpersonation()?.staffUserId).toBe('outer');
      });
      expect(currentImpersonation()).toBeNull();
    });
  });
});
