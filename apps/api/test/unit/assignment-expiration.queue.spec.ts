import {
  AssignmentExpirationQueue,
  JOB_EXPIRE_ASSIGNMENT,
} from '../../src/modules/call-center/queue/assignment-expiration.queue';
import type { RedisService } from '../../src/infrastructure/redis/redis.service';

type AnyArgs = Record<string, unknown>;

/**
 * Regression lock (surfaced by the M7 e2e): BullMQ rejects ':' in a
 * custom jobId (its Redis key separator). The assignedAt ISO is full of
 * colons, so enqueueExpiration must encode a colon-free deterministic id.
 */
describe('AssignmentExpirationQueue.enqueueExpiration jobId', () => {
  function make() {
    const add = jest.fn<Promise<{ id: string }>, [string, AnyArgs, AnyArgs]>(
      async () => ({ id: 'job-1' }),
    );
    const q = new AssignmentExpirationQueue({} as unknown as RedisService);
    (q as unknown as { queue: { add: typeof add } }).queue = { add };
    return { q, add };
  }

  it('builds a deterministic, colon-free jobId from (assignment, assignedAt)', async () => {
    const { q, add } = make();
    const iso = '2026-05-18T10:00:00.000Z';
    await q.enqueueExpiration(
      { assignmentId: 'aaaaaaaa-bbbb-7ccc-8ddd-eeeeeeeeeeee', assignedAtIso: iso },
      30 * 60_000,
    );
    const [name, , opts] = add.mock.calls[0]!;
    expect(name).toBe(JOB_EXPIRE_ASSIGNMENT);
    const jobId = opts.jobId as string;
    expect(jobId).not.toContain(':');
    expect(jobId).toBe(
      `aaaaaaaa-bbbb-7ccc-8ddd-eeeeeeeeeeee_${Date.parse(iso)}`,
    );
    expect(opts.delay).toBe(30 * 60_000);
  });

  it('is stable for the same (assignment, assignedAt) — dedupes a re-pull', async () => {
    const { q, add } = make();
    const job = {
      assignmentId: 'aaaaaaaa-bbbb-7ccc-8ddd-eeeeeeeeeeee',
      assignedAtIso: '2026-05-18T10:00:00.000Z',
    };
    await q.enqueueExpiration(job, 1000);
    await q.enqueueExpiration(job, 1000);
    expect(add.mock.calls[0]![2].jobId).toBe(add.mock.calls[1]![2].jobId);
  });
});
