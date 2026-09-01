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
  const svc = new SystemIssueService({ client: { systemIssue } } as never);
  return { svc, systemIssue };
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
