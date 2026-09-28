import { SystemIssueService } from '../../src/modules/system-issues/services/system-issue.service';

/**
 * The board is only worth reading if what lands on it is worth acting
 * on. These pin the two judgements that decide that.
 */
function build() {
  const systemIssue = {
    updateMany: jest.fn(async () => ({ count: 0 })),
    findFirst: jest.fn(async () => null),
    create: jest.fn(async (_args: { data: Record<string, unknown> }) => ({ id: 'issue-1' })),
  };
  // Recording a problem and telling somebody are two acts; the notifier
  // is the second. Recorded rather than stubbed away so the cases below
  // can assert on WHO is told, and when nobody is.
  const notify = jest.fn(async () => undefined);
  const svc = new SystemIssueService(
    { client: { systemIssue } } as never,
    {
      notify,
    } as never,
  );
  return { svc, systemIssue, notify };
}

describe('SystemIssueService — what reaches the board', () => {
  describe('a job that failed', () => {
    it('says nothing while BullMQ is still retrying', async () => {
      const { svc, systemIssue } = build();
      await svc.reportJobFailure('EmailWorker', { attemptsMade: 2, opts: { attempts: 5 } }, 'x');
      expect(systemIssue.create).not.toHaveBeenCalled();
      expect(systemIssue.updateMany).not.toHaveBeenCalled();
    });

    it('reports once the retries are exhausted — that work is not happening', async () => {
      const { svc, systemIssue } = build();
      await svc.reportJobFailure(
        'EmailWorker',
        { id: 'j1', attemptsMade: 5, opts: { attempts: 5 } },
        new Error('SMTP refused'),
      );
      expect(systemIssue.create).toHaveBeenCalledTimes(1);
      const arg = systemIssue.create.mock.calls[0]?.[0] as {
        data: { dedupeKey: string; detail: string };
      };
      expect(arg.data.dedupeKey).toBe('job-failed:EmailWorker');
      expect(arg.data.detail).toContain('SMTP refused');
    });

    it('treats a single-attempt job (a cron sweep) as exhausted immediately', async () => {
      const { svc, systemIssue } = build();
      // A cron worker has no retry policy; the run either happened or it
      // did not, so waiting for a retry that never comes would mean
      // never reporting a failed sweep at all.
      await svc.reportJobFailure('NsaSweepWorker', undefined, 'boom');
      expect(systemIssue.create).toHaveBeenCalledTimes(1);
    });
  });

  describe('a worker that errored', () => {
    it('keys on the worker, so one erroring all day is one card', async () => {
      const { svc, systemIssue } = build();
      systemIssue.updateMany.mockResolvedValueOnce({ count: 0 });
      await svc.reportWorkerError('TrackingPollWorker', new Error('ECONNRESET'));
      const arg = systemIssue.create.mock.calls[0]?.[0] as {
        data: { dedupeKey: string };
      };
      expect(arg.data.dedupeKey).toBe('worker-error:TrackingPollWorker');
    });

    it('never throws — reporting a failure must not become one', async () => {
      const { svc, systemIssue } = build();
      systemIssue.updateMany.mockRejectedValueOnce(new Error('db down'));
      await expect(svc.reportWorkerError('AnyWorker', 'x')).resolves.toBeUndefined();
    });
  });
});

describe('an endpoint that threw', () => {
  it('records the ROUTE, not the URL, so one bug is one row', async () => {
    const { svc, systemIssue } = build();
    await svc.reportRequestFailure({
      method: 'GET',
      route: '/admin/tickets/:ticketId',
      exception: new TypeError('Cannot read properties of undefined'),
      requestId: 'req-1',
    });
    const arg = systemIssue.create.mock.calls[0]?.[0] as {
      data: { dedupeKey: string; title: string; metadata: Record<string, unknown> };
    };
    // Keyed on the route and the error NAME. The URL would open a fresh
    // issue per request and bury the board; the error MESSAGE often
    // carries the id it choked on, which splits one bug across every
    // request that hit it.
    expect(arg.data.dedupeKey).toBe('api-error:GET /admin/tickets/:ticketId:TypeError');
    expect(arg.data.title).toBe('GET /admin/tickets/:ticketId is failing');
    expect(arg.data.metadata.requestId).toBe('req-1');
  });

  it('is MEDIUM, so it lands on the page without paging anybody', async () => {
    const { svc, systemIssue, notify } = build();
    await svc.reportRequestFailure({
      method: 'POST',
      route: '/seller/orders',
      exception: new Error('boom'),
      requestId: null,
    });
    const arg = systemIssue.create.mock.calls[0]?.[0] as { data: { severity: string } };
    expect(arg.data.severity).toBe('MEDIUM');
    // notify() is still called — it is the notifier that decides MEDIUM
    // does not interrupt anybody (NOTIF-16). Asserted here so a future
    // change that starts paging on every 500 is a deliberate one.
    expect(notify).toHaveBeenCalledWith(expect.objectContaining({ severity: 'MEDIUM' }));
  });

  it('survives a thrown non-Error', async () => {
    const { svc, systemIssue } = build();
    // Anything can be thrown in JavaScript, and a filter that only
    // handles Error would itself throw inside the failure path.
    await svc.reportRequestFailure({
      method: 'GET',
      route: '/x',
      exception: 'a string',
      requestId: null,
    });
    expect(systemIssue.create).toHaveBeenCalledTimes(1);
  });
});

describe('raises are drainable', () => {
  /**
   * Fifty-odd call sites reach this service as `void issues.raise(...)`.
   * That is correct — raising must never delay the failure path that
   * triggered it — and it is why the work needs somewhere to be
   * awaited. Undrained, it races the e2e reset's TRUNCATE and Postgres
   * kills one of them with a 40P01 naming neither the test nor the
   * cause. Found on CI, shard 4 of 4.
   */
  it('drainInFlight waits for a raise nobody awaited', async () => {
    const { svc, systemIssue } = build();
    let release: () => void = () => {};
    systemIssue.create.mockImplementationOnce(
      async () =>
        new Promise((res) => {
          release = () => res({ id: 'issue-slow' });
        }),
    );
    void svc.reportWorkerError('SlowWorker', new Error('x'));
    // Let the fire-and-forget reach the create() that is now hanging.
    await Promise.resolve();
    await Promise.resolve();

    let drained = false;
    const draining = svc.drainInFlight().then(() => {
      drained = true;
    });
    await Promise.resolve();
    expect(drained).toBe(false);

    release();
    await draining;
    expect(drained).toBe(true);
  });

  it('a raise that FAILED still leaves the set — the drain cannot hang on it', async () => {
    const { svc, systemIssue } = build();
    systemIssue.updateMany.mockRejectedValueOnce(new Error('db gone'));
    // Swallowed by design: the caller is already handling a failure and
    // must not inherit a second one.
    await svc.raise({
      kind: 'OTHER',
      severity: 'LOW',
      title: 't',
      detail: 'd',
      source: 's',
      dedupeKey: 'k',
    } as never);
    await expect(svc.drainInFlight()).resolves.toBeUndefined();
  });
});

/**
 * A recurring sweep is judged on RUNS.
 *
 * On 24 September 2026 one brief database failover caught three
 * scheduled sweeps mid-run, and each of them opened a card that was
 * still open four days later describing a database that had been
 * healthy the whole time. A sweep loses no work to a failed run — the
 * next tick repeats it — so one failed run is not a fact worth a
 * permanent alert, and three permanent alerts that are not facts is how
 * a real one gets scrolled past.
 */
describe('a scheduled job that failed a run', () => {
  /** What BullMQ hands a `failed` listener for occurrence `iteration`. */
  function tick(iteration: number) {
    return {
      id: `j-${iteration}`,
      name: 'sweep-overdue-pack-boxes',
      attemptsMade: 1,
      opts: { attempts: 1, repeat: { count: iteration } },
    };
  }
  const unreachable = new Error(
    "Can't reach database server at `private-skydrop-db-prod-do-user-1-0.j.db.ondigitalocean.com:25060`",
  );

  it('says nothing when ONE run dies — the next run does the same work', async () => {
    const { svc, systemIssue } = build();
    await svc.reportJobFailure('PackBoxExpiryWorker', tick(41), unreachable);
    expect(systemIssue.create).not.toHaveBeenCalled();
    expect(systemIssue.updateMany).not.toHaveBeenCalled();
  });

  it('reports once three runs in a row have failed', async () => {
    const { svc, systemIssue } = build();
    await svc.reportJobFailure('PackBoxExpiryWorker', tick(41), unreachable);
    await svc.reportJobFailure('PackBoxExpiryWorker', tick(42), unreachable);
    expect(systemIssue.create).not.toHaveBeenCalled();
    await svc.reportJobFailure('PackBoxExpiryWorker', tick(43), unreachable);

    expect(systemIssue.create).toHaveBeenCalledTimes(1);
    const arg = systemIssue.create.mock.calls[0]?.[0] as {
      data: { dedupeKey: string; title: string; detail: string; metadata: Record<string, unknown> };
    };
    expect(arg.data.dedupeKey).toBe('job-failed:PackBoxExpiryWorker');
    expect(arg.data.title).toContain('3 runs in a row');
    expect(arg.data.metadata.failedRuns).toBe(3);
    expect(arg.data.metadata.recurring).toBe(true);
  });

  it('starts counting again when the failures are not consecutive runs', async () => {
    const { svc, systemIssue } = build();
    // Three separate blips, far apart in the schedule. Each one had
    // successful runs on either side of it, so none of them is evidence
    // that the sweep has stopped working.
    await svc.reportJobFailure('PackBoxExpiryWorker', tick(41), unreachable);
    await svc.reportJobFailure('PackBoxExpiryWorker', tick(180), unreachable);
    await svc.reportJobFailure('PackBoxExpiryWorker', tick(900), unreachable);
    expect(systemIssue.create).not.toHaveBeenCalled();
  });

  it('closes the card once a later run has clearly succeeded', async () => {
    const { svc, systemIssue } = build();
    for (const i of [41, 42, 43]) {
      await svc.reportJobFailure('PackBoxExpiryWorker', tick(i), unreachable);
    }
    expect(systemIssue.create).toHaveBeenCalledTimes(1);

    // Runs 44 through 99 did not reach the `failed` listener, so they did
    // not fail — which is the only success signal available without a
    // hook in every worker in the estate.
    await svc.reportJobFailure('PackBoxExpiryWorker', tick(100), unreachable);
    type UpdateManyCall = [{ where: { dedupeKey: string }; data: Record<string, unknown> }];
    const calls = systemIssue.updateMany.mock.calls as unknown as UpdateManyCall[];
    const resolved = calls.filter((c) => c[0].data.resolvedAt !== undefined);
    expect(resolved).toHaveLength(1);
    expect(resolved[0]?.[0].where.dedupeKey).toBe('job-failed:PackBoxExpiryWorker');
  });

  it('reports a SLOW job on its second consecutive night, not its third', async () => {
    jest.useFakeTimers();
    try {
      const { svc, systemIssue } = build();
      jest.setSystemTime(new Date('2026-09-24T02:40:00Z'));
      await svc.reportJobFailure('WalletSyncWorker', tick(9), unreachable);
      expect(systemIssue.create).not.toHaveBeenCalled();
      // Waiting for a third run would mean three days of silence about a
      // nightly sync that stopped working on Monday.
      jest.setSystemTime(new Date('2026-09-25T02:40:00Z'));
      await svc.reportJobFailure('WalletSyncWorker', tick(10), unreachable);
      expect(systemIssue.create).toHaveBeenCalledTimes(1);
    } finally {
      jest.useRealTimers();
    }
  });

  it('names the database rather than sending the reader hunting for a bad row', async () => {
    const { svc, systemIssue } = build();
    for (const i of [1, 2, 3]) {
      await svc.reportJobFailure('StoreRequestExpiryWorker', tick(i), unreachable);
    }
    const arg = systemIssue.create.mock.calls[0]?.[0] as {
      data: { detail: string; metadata: Record<string, unknown> };
    };
    expect(arg.data.metadata.cause).toBe('INFRASTRUCTURE');
    expect(arg.data.detail).toContain('unreachable');
    expect(arg.data.detail).not.toContain('one bad row');
  });

  it('still reports a ONE-OFF job on its first exhausted failure', async () => {
    const { svc, systemIssue } = build();
    // Nothing is coming to redo this. An email nobody got stays ungot.
    await svc.reportJobFailure(
      'EmailWorker',
      { id: 'j1', name: 'send-email', attemptsMade: 5, opts: { attempts: 5 } },
      new Error('SMTP refused'),
    );
    expect(systemIssue.create).toHaveBeenCalledTimes(1);
    const arg = systemIssue.create.mock.calls[0]?.[0] as {
      data: { title: string; metadata: Record<string, unknown> };
    };
    expect(arg.data.title).toBe('EmailWorker gave up on a job');
    expect(arg.data.metadata.recurring).toBe(false);
  });

  it('reports a scheduled job whose iteration BullMQ did not stamp', async () => {
    const { svc, systemIssue } = build();
    // We cannot tell one run from the next here, so it falls back to the
    // one-off treatment. Going quieter than the old behaviour on the
    // strength of something we could not establish would be the wrong
    // way to be wrong, and a card claiming "1 runs in a row" would be a
    // sentence about evidence we do not have.
    await svc.reportJobFailure(
      'SomeWorker',
      { id: 'j1', name: 'sweep', attemptsMade: 1, opts: { attempts: 1, repeat: {} } },
      unreachable,
    );
    expect(systemIssue.create).toHaveBeenCalledTimes(1);
    const arg = systemIssue.create.mock.calls[0]?.[0] as {
      data: { title: string; metadata: Record<string, unknown> };
    };
    expect(arg.data.title).toBe('SomeWorker gave up on a job');
    expect(arg.data.metadata.recurring).toBe(false);
  });
});
