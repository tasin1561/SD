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
