import {
  PickExpirationQueue,
  JOB_EXPIRE_PICK,
} from '../../src/modules/warehouse-pick/queue/pick-expiration.queue';
import type { RedisService } from '../../src/infrastructure/redis/redis.service';

type AnyArgs = Record<string, unknown>;

/**
 * Regression lock (same class of bug M7's e2e surfaced): BullMQ rejects
 * ':' in a custom jobId (its Redis key separator). The pickStartedAt ISO
 * is full of colons, so enqueueExpiration must encode a colon-free
 * deterministic id.
 */
describe('PickExpirationQueue.enqueueExpiration jobId', () => {
  function make() {
    const add = jest.fn<Promise<{ id: string }>, [string, AnyArgs, AnyArgs]>(async () => ({
      id: 'job-1',
    }));
    const q = new PickExpirationQueue({} as unknown as RedisService);
    (q as unknown as { queue: { add: typeof add } }).queue = { add };
    return { q, add };
  }

  it('builds a deterministic, colon-free jobId from (shipment, pickStartedAt)', async () => {
    const { q, add } = make();
    const iso = '2026-05-19T08:00:00.000Z';
    await q.enqueueExpiration(
      { shipmentId: 'aaaaaaaa-bbbb-7ccc-8ddd-eeeeeeeeeeee', pickStartedAtIso: iso },
      4 * 3_600_000,
    );
    const [name, , opts] = add.mock.calls[0] ?? [];
    expect(name).toBe(JOB_EXPIRE_PICK);
    const jobId = (opts as AnyArgs).jobId as string;
    expect(jobId).not.toContain(':');
    expect(jobId).toBe(`aaaaaaaa-bbbb-7ccc-8ddd-eeeeeeeeeeee_${Date.parse(iso)}`);
    expect((opts as AnyArgs).delay).toBe(4 * 3_600_000);
  });

  it('clamps a negative delay to 0', async () => {
    const { q, add } = make();
    await q.enqueueExpiration(
      { shipmentId: 's1', pickStartedAtIso: '2026-05-19T08:00:00.000Z' },
      -5_000,
    );
    expect((add.mock.calls[0]?.[2] as AnyArgs).delay).toBe(0);
  });

  it('is stable for the same (shipment, pickStartedAt) — dedupes a re-pull', async () => {
    const { q, add } = make();
    const job = {
      shipmentId: 'aaaaaaaa-bbbb-7ccc-8ddd-eeeeeeeeeeee',
      pickStartedAtIso: '2026-05-19T08:00:00.000Z',
    };
    await q.enqueueExpiration(job, 1000);
    await q.enqueueExpiration(job, 1000);
    expect((add.mock.calls[0]?.[2] as AnyArgs).jobId).toBe(
      (add.mock.calls[1]?.[2] as AnyArgs).jobId,
    );
  });
});
