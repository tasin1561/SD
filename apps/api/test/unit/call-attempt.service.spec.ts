import {
  CallOutcome,
  CallQueueStatus,
  OrderStatus,
  QueueClosureReason,
} from '@skydrop/db';
import { CallAttemptService } from '../../src/modules/call-center/services/call-attempt.service';
import { CallOutcomeMappingService } from '../../src/modules/call-center/services/call-outcome-mapping.service';
import type { PrismaService } from '../../src/infrastructure/prisma/prisma.service';
import type { AuditLogService } from '../../src/modules/auth-common/services/audit-log.service';
import type { OrderReadService } from '../../src/modules/order/services/order-read.service';
import type { OrderWriteService } from '../../src/modules/order/services/order-write.service';
import type { CallQueueService } from '../../src/modules/call-queue/services/call-queue.service';

type AnyArgs = Record<string, unknown>;

const SETTING_KEYS = {
  MAX: 'ops.call_max_attempts_before_ndr',
  MIN_H: 'ops.call_reschedule_min_hours',
  MAX_D: 'ops.call_reschedule_max_days',
  BUSY_H: 'ops.call_busy_retry_delay_hours',
};

function makeService(
  opts: {
    entry?: AnyArgs | null;
    order?: AnyArgs | null;
    priorCount?: number;
    maxAttemptsSetting?: number | null;
    sellerOverride?: number | null;
    busyDelayHours?: number | null;
    transitionResult?: AnyArgs;
    transitionThrows?: boolean;
  } = {},
) {
  const defaultEntry = {
    id: 'q1',
    orderId: 'o1',
    status: CallQueueStatus.ASSIGNED,
    assignedAgentId: 'agent-1',
  };
  const entryFindUnique = jest.fn<Promise<AnyArgs | null>, [AnyArgs]>(async () =>
    opts.entry === undefined ? defaultEntry : opts.entry,
  );
  const attemptCount = jest.fn<Promise<number>, [AnyArgs]>(
    async () => opts.priorCount ?? 0,
  );
  const attemptCreate = jest.fn<Promise<{ id: string }>, [AnyArgs]>(async () => ({
    id: 'att-1',
  }));
  const entryUpdate = jest.fn<Promise<AnyArgs>, [AnyArgs]>(async () => ({}));
  const sellerFindUnique = jest.fn<Promise<AnyArgs | null>, [AnyArgs]>(async () => ({
    callMaxAttemptsBeforeNdrOverride: opts.sellerOverride ?? null,
  }));
  const systemSettingFindUnique = jest.fn<Promise<AnyArgs | null>, [AnyArgs]>(
    async (a) => {
      const key = (a.where as AnyArgs).key as string;
      if (key === SETTING_KEYS.MAX) {
        return opts.maxAttemptsSetting === null ||
          opts.maxAttemptsSetting === undefined
          ? null
          : { valueInt: opts.maxAttemptsSetting };
      }
      if (key === SETTING_KEYS.BUSY_H) {
        return opts.busyDelayHours === null ||
          opts.busyDelayHours === undefined
          ? null
          : { valueInt: opts.busyDelayHours };
      }
      return null; // MIN_H / MAX_D → service defaults (1h / 7d)
    },
  );

  const txClient = {
    callAttempt: { count: attemptCount, create: attemptCreate },
    callQueueEntry: { update: entryUpdate },
  };
  const client = {
    callQueueEntry: { findUnique: entryFindUnique },
    seller: { findUnique: sellerFindUnique },
    systemSetting: { findUnique: systemSettingFindUnique },
  } as {
    callQueueEntry: { findUnique: typeof entryFindUnique };
    seller: { findUnique: typeof sellerFindUnique };
    systemSetting: { findUnique: typeof systemSettingFindUnique };
    $transaction: <T>(fn: (tx: unknown) => Promise<T>) => Promise<T>;
  };
  client.$transaction = <T>(fn: (tx: unknown) => Promise<T>): Promise<T> =>
    fn(txClient);

  const auditLog = jest.fn<Promise<string | null>, [AnyArgs, unknown?]>(
    async () => 'a1',
  );
  const audit = { log: auditLog };

  const order =
    opts.order === undefined
      ? { orderId: 'o1', sellerId: 's1', recipient: { phoneE164: '+919876500000' } }
      : opts.order;
  const getById = jest.fn(async () => order);
  const orders = { getById };

  const transitionStatus = jest.fn(async (i: { orderId: string; to: OrderStatus }) => {
    if (opts.transitionThrows) throw new Error('saga boom');
    return (
      opts.transitionResult ?? {
        orderId: i.orderId,
        fromStatus: OrderStatus.PENDING_CONFIRMATION,
        status: i.to,
        reservationOutcome: null,
      }
    );
  });
  const orderWrites = { transitionStatus };

  const enqueueAgain = jest.fn<
    Promise<AnyArgs>,
    [string, Date, unknown?]
  >(async () => ({ entry: {}, created: true }));
  const queue = { enqueueAgain };

  const mapping = new CallOutcomeMappingService();

  const svc = new CallAttemptService(
    { client } as unknown as PrismaService,
    audit as unknown as AuditLogService,
    orders as unknown as OrderReadService,
    orderWrites as unknown as OrderWriteService,
    queue as unknown as CallQueueService,
    mapping,
  );
  return {
    svc,
    entryFindUnique,
    attemptCount,
    attemptCreate,
    entryUpdate,
    auditLog,
    transitionStatus,
    enqueueAgain,
  };
}

const BASE = {
  assignmentId: 'q1',
  agentId: 'agent-1',
  startedAt: new Date('2026-05-18T10:00:00Z'),
  endedAt: new Date('2026-05-18T10:03:20Z'),
};

describe('CallAttemptService.recordAttempt — assignment guards', () => {
  it('404 when the assignment does not exist', async () => {
    const { svc } = makeService({ entry: null });
    await expect(
      svc.recordAttempt({ ...BASE, outcome: CallOutcome.CONFIRMED }),
    ).rejects.toMatchObject({ status: 404 });
  });

  it('409 ASSIGNMENT_NOT_ACTIVE when not ASSIGNED', async () => {
    const { svc } = makeService({
      entry: { id: 'q1', orderId: 'o1', status: CallQueueStatus.COMPLETED, assignedAgentId: 'agent-1' },
    });
    await expect(
      svc.recordAttempt({ ...BASE, outcome: CallOutcome.CONFIRMED }),
    ).rejects.toMatchObject({ response: { code: 'ASSIGNMENT_NOT_ACTIVE' } });
  });

  it('403 ASSIGNMENT_NOT_OWNED when held by another agent', async () => {
    const { svc } = makeService({
      entry: { id: 'q1', orderId: 'o1', status: CallQueueStatus.ASSIGNED, assignedAgentId: 'agent-2' },
    });
    await expect(
      svc.recordAttempt({ ...BASE, outcome: CallOutcome.CONFIRMED }),
    ).rejects.toMatchObject({ response: { code: 'ASSIGNMENT_NOT_OWNED' } });
  });
});

describe('CallAttemptService.recordAttempt — scheduledFor invariants', () => {
  it('rejects scheduledFor on a non-callback outcome', async () => {
    const { svc } = makeService();
    await expect(
      svc.recordAttempt({
        ...BASE,
        outcome: CallOutcome.NO_ANSWER,
        scheduledFor: new Date(Date.now() + 3 * 3_600_000),
      }),
    ).rejects.toMatchObject({ response: { code: 'SCHEDULED_FOR_NOT_ALLOWED' } });
  });

  it('requires scheduledFor for CALLBACK_REQUESTED', async () => {
    const { svc } = makeService();
    await expect(
      svc.recordAttempt({ ...BASE, outcome: CallOutcome.CALLBACK_REQUESTED }),
    ).rejects.toMatchObject({ response: { code: 'SCHEDULED_FOR_REQUIRED' } });
  });

  it('rejects an out-of-bounds callback time (< min 1h)', async () => {
    const { svc } = makeService();
    await expect(
      svc.recordAttempt({
        ...BASE,
        outcome: CallOutcome.CALLBACK_REQUESTED,
        scheduledFor: new Date(Date.now() + 30 * 60_000), // 30 min < 1h
      }),
    ).rejects.toMatchObject({ response: { code: 'SCHEDULED_FOR_OUT_OF_BOUNDS' } });
  });
});

describe('CallAttemptService.recordAttempt — outcome flows', () => {
  it('CONFIRMED: attempt persisted, entry COMPLETED+ORDER_CONFIRMED, transition called, no requeue', async () => {
    const { svc, attemptCreate, entryUpdate, transitionStatus, enqueueAgain, auditLog } =
      makeService();
    const r = await svc.recordAttempt({ ...BASE, outcome: CallOutcome.CONFIRMED });

    expect((attemptCreate.mock.calls[0]![0].data as AnyArgs).outcome).toBe(
      CallOutcome.CONFIRMED,
    );
    expect((attemptCreate.mock.calls[0]![0].data as AnyArgs).phoneE164).toBe(
      '+919876500000',
    );
    const upd = entryUpdate.mock.calls[0]![0].data as AnyArgs;
    expect(upd).toMatchObject({
      status: CallQueueStatus.COMPLETED,
      closureReason: QueueClosureReason.ORDER_CONFIRMED,
    });
    expect(transitionStatus).toHaveBeenCalledWith(
      expect.objectContaining({ orderId: 'o1', to: OrderStatus.CONFIRMED }),
    );
    expect(enqueueAgain).not.toHaveBeenCalled();
    expect(r).toMatchObject({
      attemptId: 'att-1',
      finalOrderStatus: OrderStatus.CONFIRMED,
      requeued: false,
      hitCap: false,
    });
    // no HIGH transition-failed audit
    expect(
      auditLog.mock.calls.some(
        (c) => (c[0] as AnyArgs).action === 'call_attempt.transition_failed',
      ),
    ).toBe(false);
  });

  it('CONFIRMED but M5 saga lands OUT_OF_STOCK: attempt keeps outcome=CONFIRMED, finalOrderStatus=OUT_OF_STOCK', async () => {
    const { svc, attemptCreate, transitionStatus } = makeService({
      transitionResult: {
        orderId: 'o1',
        fromStatus: OrderStatus.PENDING_CONFIRMATION,
        status: OrderStatus.OUT_OF_STOCK,
        reservationOutcome: 'OUT_OF_STOCK',
      },
    });
    const r = await svc.recordAttempt({ ...BASE, outcome: CallOutcome.CONFIRMED });
    expect((attemptCreate.mock.calls[0]![0].data as AnyArgs).outcome).toBe(
      CallOutcome.CONFIRMED,
    );
    expect(transitionStatus).toHaveBeenCalled();
    expect(r.finalOrderStatus).toBe(OrderStatus.OUT_OF_STOCK);
  });

  it('transition throws: attempt persists, HIGH audit written, no upstream throw', async () => {
    const { svc, attemptCreate, auditLog } = makeService({ transitionThrows: true });
    const r = await svc.recordAttempt({ ...BASE, outcome: CallOutcome.CONFIRMED });
    expect(attemptCreate).toHaveBeenCalled();
    expect(r.attemptId).toBe('att-1');
    expect(r.finalOrderStatus).toBeNull();
    const high = auditLog.mock.calls.find(
      (c) => (c[0] as AnyArgs).action === 'call_attempt.transition_failed',
    );
    expect(high).toBeDefined();
    expect((high![0] as AnyArgs).severity).toBe('HIGH');
  });

  it('NO_ANSWER at cap → REJECTED_NDR, no requeue, MAX_ATTEMPTS_EXCEEDED', async () => {
    const { svc, entryUpdate, transitionStatus, enqueueAgain } = makeService({
      priorCount: 2, // +1 this attempt = 3 = default cap
    });
    const r = await svc.recordAttempt({ ...BASE, outcome: CallOutcome.NO_ANSWER });
    expect(transitionStatus).toHaveBeenCalledWith(
      expect.objectContaining({ to: OrderStatus.REJECTED_NDR }),
    );
    expect(enqueueAgain).not.toHaveBeenCalled();
    expect((entryUpdate.mock.calls[0]![0].data as AnyArgs).closureReason).toBe(
      QueueClosureReason.MAX_ATTEMPTS_EXCEEDED,
    );
    expect(r).toMatchObject({ hitCap: true, requeued: false });
  });

  it('NO_ANSWER below cap → CALL_NO_RESPONSE, requeue immediate (~now)', async () => {
    const { svc, transitionStatus, enqueueAgain } = makeService({ priorCount: 0 });
    const r = await svc.recordAttempt({ ...BASE, outcome: CallOutcome.NO_ANSWER });
    expect(transitionStatus).toHaveBeenCalledWith(
      expect.objectContaining({ to: OrderStatus.CALL_NO_RESPONSE }),
    );
    expect(enqueueAgain).toHaveBeenCalled();
    expect(enqueueAgain.mock.calls[0]![0]).toBe('o1');
    const at = enqueueAgain.mock.calls[0]![1] as Date;
    expect(Math.abs(at.getTime() - Date.now())).toBeLessThan(5_000);
    expect(r.requeued).toBe(true);
  });

  it('BUSY → CALL_NO_RESPONSE, requeue at now + busy delay (configurable 2h)', async () => {
    const { svc, enqueueAgain } = makeService({ priorCount: 0, busyDelayHours: 2 });
    await svc.recordAttempt({ ...BASE, outcome: CallOutcome.BUSY });
    const at = (enqueueAgain.mock.calls[0]![1] as Date).getTime();
    const expected = Date.now() + 2 * 3_600_000;
    expect(Math.abs(at - expected)).toBeLessThan(5_000);
  });

  it('CALLBACK_REQUESTED → CALL_RESCHEDULED, requeue at agent-provided time', async () => {
    const { svc, transitionStatus, enqueueAgain } = makeService({ priorCount: 0 });
    const sched = new Date(Date.now() + 3 * 3_600_000); // within [1h, 7d]
    const r = await svc.recordAttempt({
      ...BASE,
      outcome: CallOutcome.CALLBACK_REQUESTED,
      scheduledFor: sched,
    });
    expect(transitionStatus).toHaveBeenCalledWith(
      expect.objectContaining({ to: OrderStatus.CALL_RESCHEDULED }),
    );
    expect(enqueueAgain).toHaveBeenCalledWith('o1', sched, undefined);
    expect(r.requeuedAvailableAt).toEqual(sched);
  });

  it('TECHNICAL_FAILURE: no transition (status unchanged), requeue, not cap-counting', async () => {
    const { svc, transitionStatus, enqueueAgain, attemptCount } = makeService({
      priorCount: 9,
    });
    const r = await svc.recordAttempt({
      ...BASE,
      outcome: CallOutcome.TECHNICAL_FAILURE,
    });
    expect(transitionStatus).not.toHaveBeenCalled();
    expect(enqueueAgain).toHaveBeenCalled();
    expect(r).toMatchObject({ targetStatus: null, finalOrderStatus: null, requeued: true });
    // priorCount query filtered to the 6 counting outcomes only
    const where = attemptCount.mock.calls[0]![0].where as AnyArgs;
    expect((where.outcome as AnyArgs).in).not.toContain(
      CallOutcome.TECHNICAL_FAILURE,
    );
  });

  it('LANGUAGE_BARRIER: no transition, requeue immediate', async () => {
    const { svc, transitionStatus, enqueueAgain } = makeService();
    const r = await svc.recordAttempt({
      ...BASE,
      outcome: CallOutcome.LANGUAGE_BARRIER,
    });
    expect(transitionStatus).not.toHaveBeenCalled();
    expect(enqueueAgain).toHaveBeenCalled();
    expect(r.targetStatus).toBeNull();
  });
});
