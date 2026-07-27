import { CallQueueStatus } from '@skydrop/db';
import { AssignmentExpirationService } from '../../src/modules/call-center/services/assignment-expiration.service';
import type { PrismaService } from '../../src/infrastructure/prisma/prisma.service';
import type { AuditLogService } from '../../src/modules/auth-common/services/audit-log.service';
import type { AssignmentExpirationQueue } from '../../src/modules/call-center/queue/assignment-expiration.queue';

type AnyArgs = Record<string, unknown>;

const ASSIGNED_AT = new Date('2026-05-18T10:00:00.000Z');

function makeService(
  opts: {
    timeoutValueInt?: number | null; // null → no settings row
    entry?: AnyArgs | null; // findUnique result; undefined → a default ASSIGNED entry
    updateCount?: number;
  } = {},
) {
  const settingFindUnique = jest.fn<Promise<AnyArgs | null>, [AnyArgs]>(async () =>
    opts.timeoutValueInt === null || opts.timeoutValueInt === undefined
      ? null
      : { valueInt: opts.timeoutValueInt },
  );
  const defaultEntry = {
    id: 'q1',
    orderId: 'o1',
    status: CallQueueStatus.ASSIGNED,
    assignedAgentId: 'agent-1',
    assignedAt: ASSIGNED_AT,
  };
  const entryFindUnique = jest.fn<Promise<AnyArgs | null>, [AnyArgs]>(async () =>
    opts.entry === undefined ? defaultEntry : opts.entry,
  );
  const updateMany = jest.fn<Promise<{ count: number }>, [AnyArgs]>(async () => ({
    count: opts.updateCount ?? 1,
  }));
  const client = {
    systemSetting: { findUnique: settingFindUnique },
    callQueueEntry: { findUnique: entryFindUnique, updateMany },
  };
  const auditLog = jest.fn<Promise<string | null>, [AnyArgs]>(async () => 'a1');
  const audit = { log: auditLog };
  const enqueueExpiration = jest.fn<Promise<string>, [AnyArgs, number]>(async () => 'job-1');
  const queue = { enqueueExpiration };

  const svc = new AssignmentExpirationService(
    { client } as unknown as PrismaService,
    audit as unknown as AuditLogService,
    queue as unknown as AssignmentExpirationQueue,
  );
  return { svc, settingFindUnique, entryFindUnique, updateMany, auditLog, enqueueExpiration };
}

describe('AssignmentExpirationService.scheduleExpiration', () => {
  it('defaults to 30 min (no settings row) and carries assignedAt ISO', async () => {
    const { svc, enqueueExpiration } = makeService({ timeoutValueInt: null });
    await svc.scheduleExpiration('q1', ASSIGNED_AT);
    expect(enqueueExpiration).toHaveBeenCalledWith(
      { assignmentId: 'q1', assignedAtIso: ASSIGNED_AT.toISOString() },
      30 * 60_000,
    );
  });

  it('honors ops.call_assignment_timeout_minutes override', async () => {
    const { svc, enqueueExpiration } = makeService({ timeoutValueInt: 45 });
    await svc.scheduleExpiration('q1', ASSIGNED_AT);
    expect(enqueueExpiration.mock.calls[0]![1]).toBe(45 * 60_000);
  });
});

describe('AssignmentExpirationService.expire', () => {
  it('reverts ASSIGNED→PENDING + clears agent + audits when still current', async () => {
    const { svc, updateMany, auditLog } = makeService();
    const r = await svc.expire('q1', ASSIGNED_AT.toISOString());
    expect(r).toEqual({ expired: true });
    const data = updateMany.mock.calls[0]![0].data as AnyArgs;
    expect(data).toMatchObject({
      status: CallQueueStatus.PENDING,
      assignedAgentId: null,
      assignedAt: null,
    });
    const where = updateMany.mock.calls[0]![0].where as AnyArgs;
    expect(where).toMatchObject({
      id: 'q1',
      status: CallQueueStatus.ASSIGNED,
      assignedAt: ASSIGNED_AT,
    });
    expect(auditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'call_queue.assignment_expired' }),
    );
  });

  it('no-ops when the entry vanished', async () => {
    const { svc, updateMany, auditLog } = makeService({ entry: null });
    expect(await svc.expire('q1', ASSIGNED_AT.toISOString())).toEqual({ expired: false });
    expect(updateMany).not.toHaveBeenCalled();
    expect(auditLog).not.toHaveBeenCalled();
  });

  it('no-ops when entry already left ASSIGNED (e.g. dequeued)', async () => {
    const { svc, updateMany } = makeService({
      entry: {
        id: 'q1',
        orderId: 'o1',
        status: CallQueueStatus.COMPLETED,
        assignedAgentId: null,
        assignedAt: ASSIGNED_AT,
      },
    });
    expect(await svc.expire('q1', ASSIGNED_AT.toISOString())).toEqual({ expired: false });
    expect(updateMany).not.toHaveBeenCalled();
  });

  it('no-ops on a stale timer (entry re-ASSIGNED with a newer assignedAt)', async () => {
    const { svc, updateMany, auditLog } = makeService({
      entry: {
        id: 'q1',
        orderId: 'o1',
        status: CallQueueStatus.ASSIGNED,
        assignedAgentId: 'agent-2',
        assignedAt: new Date('2026-05-18T11:30:00.000Z'),
      },
    });
    // Old job scheduled for the original assignedAt must not steal the
    // fresh assignment.
    expect(await svc.expire('q1', ASSIGNED_AT.toISOString())).toEqual({ expired: false });
    expect(updateMany).not.toHaveBeenCalled();
    expect(auditLog).not.toHaveBeenCalled();
  });

  it('no-ops + skips audit when it loses the conditional-update race', async () => {
    const { svc, updateMany, auditLog } = makeService({ updateCount: 0 });
    expect(await svc.expire('q1', ASSIGNED_AT.toISOString())).toEqual({ expired: false });
    expect(updateMany).toHaveBeenCalled();
    expect(auditLog).not.toHaveBeenCalled();
  });
});
