import { DeliveryActionKind, DeliveryActionStatus } from '@skydrop/db';
import { DeliveryActionDecisionService } from '../../src/modules/delivery-action/services/delivery-action-decision.service';
import type { PrismaService } from '../../src/infrastructure/prisma/prisma.service';
import type { AuditLogService } from '../../src/modules/auth-common/services/audit-log.service';
import type { DeliveryActionService } from '../../src/modules/delivery-action/services/delivery-action.service';

type AnyArgs = Record<string, unknown>;

function makeSut(
  opts: {
    claimed?: number;
    action?: DeliveryActionKind;
    ndrOutcome?: AnyArgs;
    ndrThrows?: Error;
    heldForSeller?: boolean;
    stale?: string | null;
  } = {},
) {
  const updates: AnyArgs[] = [];
  const takeNdrAction = jest.fn(async () => {
    if (opts.ndrThrows) throw opts.ndrThrows;
    return opts.ndrOutcome ?? { success: true, awbNumber: 'AWB1', uplId: 'UPL-1', message: null };
  });
  const cancelWithCourier = jest.fn(async () => ({
    success: true,
    awbNumber: 'AWB1',
    message: null,
  }));
  const runApproved = jest.fn(async () =>
    opts.stale
      ? { status: DeliveryActionStatus.FAILED, executionRef: null, executionError: opts.stale }
      : { status: DeliveryActionStatus.EXECUTED, executionRef: 'tkt1' },
  );
  const stillApplies = jest.fn(async () => opts.stale ?? null);
  const recordFailure = jest.fn(async (_id: string, reason: string) => ({
    status: DeliveryActionStatus.FAILED,
    executionRef: null,
    executionError: reason,
  }));
  const updateManyCalls: AnyArgs[] = [];

  const client: AnyArgs = {
    orderDeliveryActionRequest: {
      updateMany: async (args: AnyArgs) => {
        updateManyCalls.push(args);
        return { count: opts.claimed ?? 1 };
      },
      findUnique: async () => ({
        needsSellerApproval: opts.heldForSeller ?? false,
        status: DeliveryActionStatus.PENDING,
        id: 'req1',
        action: opts.action ?? DeliveryActionKind.REATTEMPT,
        shipmentId: 'sh1',
        orderId: 'o1',
        sellerId: 's1',
      }),
      update: async (args: { data: AnyArgs }) => {
        updates.push(args.data);
        return {};
      },
    },
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(client),
  };

  const svc = new DeliveryActionDecisionService(
    { client } as unknown as PrismaService,
    { log: jest.fn(async () => 'a1') } as unknown as AuditLogService,
    { runApproved, stillApplies, recordFailure } as unknown as DeliveryActionService,
  );
  return {
    svc,
    updates,
    updateManyCalls,
    takeNdrAction,
    cancelWithCourier,
    runApproved,
    stillApplies,
    recordFailure,
  };
}

const CTX = { ipAddress: null, userAgent: null, requestId: null } as never;

describe('DeliveryActionDecisionService.approve', () => {
  it('claims the request before anything runs, and only one operator wins', async () => {
    // Read-then-write would let two operators both see it PENDING and
    // both act. The claim is the guard.
    const sut = makeSut({ claimed: 0 });
    await expect(sut.svc.approve('staff1', 'req1', null, CTX)).rejects.toMatchObject({
      response: { code: 'DELIVERY_ACTION_ALREADY_DECIDED' },
    });
    expect(sut.runApproved).not.toHaveBeenCalled();
  });

  it.each([DeliveryActionKind.REATTEMPT, DeliveryActionKind.RECALL, DeliveryActionKind.RTO])(
    'a %s runs the ONE approved path — never the courier NDR API (2026-09-17)',
    async (action) => {
      // A legacy PENDING re-attempt (asked 28 Aug – 1 Sep 2026) used to
      // call takeNdrAction here while every other path opens a ticket.
      const sut = makeSut({ action });
      const res = await sut.svc.approve('staff1', 'req1', 'Worth one more try', CTX);
      expect(sut.runApproved).toHaveBeenCalledWith('req1', CTX);
      expect(sut.takeNdrAction).not.toHaveBeenCalled();
      expect(sut.cancelWithCourier).not.toHaveBeenCalled();
      expect(res).toEqual({ status: DeliveryActionStatus.EXECUTED, executionRef: 'tkt1' });
    },
  );

  it('the claim precedes the run', async () => {
    const sut = makeSut();
    await sut.svc.approve('staff1', 'req1', null, CTX);
    expect(sut.updateManyCalls[0]).toMatchObject({
      data: { status: DeliveryActionStatus.APPROVED, decidedById: 'staff1' },
    });
    expect(sut.runApproved).toHaveBeenCalledTimes(1);
  });
});

describe('Skydrop admin cannot decide a request held for Seller staff (2026-09-17)', () => {
  it('the claim predicate itself excludes seller-held requests', async () => {
    const sut = makeSut();
    await sut.svc.approve('staff1', 'req1', null, CTX);
    expect(sut.updateManyCalls[0]).toMatchObject({
      where: { id: 'req1', status: DeliveryActionStatus.PENDING, needsSellerApproval: false },
    });
  });

  it('approving one is refused by name, and nothing runs', async () => {
    const sut = makeSut({ claimed: 0, heldForSeller: true });
    await expect(sut.svc.approve('staff1', 'req1', null, CTX)).rejects.toMatchObject({
      response: { code: 'DELIVERY_ACTION_HELD_FOR_SELLER' },
    });
    expect(sut.takeNdrAction).not.toHaveBeenCalled();
    expect(sut.cancelWithCourier).not.toHaveBeenCalled();
    expect(sut.runApproved).not.toHaveBeenCalled();
  });

  it('rejecting one is refused by name too', async () => {
    const sut = makeSut({ claimed: 0, heldForSeller: true });
    await expect(sut.svc.reject('staff1', 'req1', 'Not needed any more')).rejects.toMatchObject({
      response: { code: 'DELIVERY_ACTION_HELD_FOR_SELLER' },
    });
  });

  it('the list marks them waiting on the seller, so the screen shows them read-only', async () => {
    const sut = makeSut();
    const client = (sut.svc as unknown as { prisma: { client: AnyArgs } }).prisma.client;
    (client['orderDeliveryActionRequest'] as AnyArgs)['findMany'] = async () => [
      { id: 'r1', needsSellerApproval: true, status: DeliveryActionStatus.PENDING },
      { id: 'r2', needsSellerApproval: false, status: DeliveryActionStatus.PENDING },
    ];
    const rows = (await sut.svc.list()) as Array<{ id: string; waitingOnSeller: boolean }>;
    expect(rows.map((r) => [r.id, r.waitingOnSeller])).toEqual([
      ['r1', true],
      ['r2', false],
    ]);
  });
});

describe('an approval that no longer applies calls no courier (2026-09-17)', () => {
  it('is recorded FAILED by the shared path, and reported as such', async () => {
    const sut = makeSut({ stale: '[DELIVERY_ACTION_NOT_APPLICABLE] delivered' });
    const res = await sut.svc.approve('staff1', 'req1', null, CTX);
    expect(res.status).toBe(DeliveryActionStatus.FAILED);
    expect(sut.takeNdrAction).not.toHaveBeenCalled();
  });
});

describe('DeliveryActionDecisionService.reject', () => {
  it('claims on PENDING so a decided request cannot be decided twice', async () => {
    const sut = makeSut({ claimed: 0 });
    await expect(sut.svc.reject('staff1', 'req1', 'Already tried twice')).rejects.toMatchObject({
      response: { code: 'DELIVERY_ACTION_ALREADY_DECIDED' },
    });
  });
});
