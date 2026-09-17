import { DeliveryActionKind, DeliveryActionStatus } from '@skydrop/db';
import { DeliveryActionDecisionService } from '../../src/modules/delivery-action/services/delivery-action-decision.service';
import type { PrismaService } from '../../src/infrastructure/prisma/prisma.service';
import type { AuditLogService } from '../../src/modules/auth-common/services/audit-log.service';
import type { CourierShipmentActionService } from '../../src/modules/courier-ops/services/courier-shipment-action.service';
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
  const runApproved = jest.fn(async () => ({
    status: DeliveryActionStatus.EXECUTED,
    executionRef: 'tkt1',
  }));
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
    { takeNdrAction, cancelWithCourier } as unknown as CourierShipmentActionService,
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
  it('claims the request before calling the courier, and only one operator wins', async () => {
    // Read-then-write would let two operators both see it PENDING and
    // both dispatch a van. The claim is the guard.
    const sut = makeSut({ claimed: 0 });
    await expect(sut.svc.approve('staff1', 'req1', null, CTX)).rejects.toMatchObject({
      response: { code: 'DELIVERY_ACTION_ALREADY_DECIDED' },
    });
    expect(sut.takeNdrAction).not.toHaveBeenCalled();
  });

  it('a REATTEMPT reaches the courier and keeps the UPL id', async () => {
    // Delhivery returns a UPL id, not an outcome — the real answer
    // arrives later on a scan (CUR-11).
    const sut = makeSut({ action: DeliveryActionKind.REATTEMPT });
    const res = await sut.svc.approve('staff1', 'req1', 'Worth one more try', CTX);
    expect(sut.takeNdrAction).toHaveBeenCalledWith('staff1', 'sh1', 'RE-ATTEMPT', CTX);
    expect(res).toEqual({ status: DeliveryActionStatus.EXECUTED, executionRef: 'UPL-1' });
  });

  it('an RTO cancels with the courier rather than re-attempting', async () => {
    const sut = makeSut({ action: DeliveryActionKind.RTO });
    await sut.svc.approve('staff1', 'req1', null, CTX);
    expect(sut.cancelWithCourier).toHaveBeenCalled();
    expect(sut.takeNdrAction).not.toHaveBeenCalled();
  });

  it('a RECALL never touches a courier — it runs the ONE approved-recall path (the ticket too)', async () => {
    const sut = makeSut({ action: DeliveryActionKind.RECALL });
    const res = await sut.svc.approve('staff1', 'req1', null, CTX);
    expect(sut.runApproved).toHaveBeenCalledWith('req1', CTX);
    expect(sut.takeNdrAction).not.toHaveBeenCalled();
    expect(sut.cancelWithCourier).not.toHaveBeenCalled();
    expect(res.status).toBe(DeliveryActionStatus.EXECUTED);
  });

  it('a courier refusal lands FAILED, not REJECTED', async () => {
    // A human said yes and the far side could not carry it out. That is
    // a different situation from a refusal and needs a different
    // response from whoever picks it up.
    const sut = makeSut({
      ndrOutcome: { success: false, awbNumber: 'AWB1', uplId: null, message: 'Not eligible' },
    });
    const res = await sut.svc.approve('staff1', 'req1', null, CTX);
    expect(res.status).toBe(DeliveryActionStatus.FAILED);
    expect(sut.updates.at(-1)?.['executionError']).toBe('Not eligible');
  });

  it('a thrown courier error is caught and recorded, not propagated', async () => {
    const sut = makeSut({ ndrThrows: new Error('Delhivery 503') });
    const res = await sut.svc.approve('staff1', 'req1', null, CTX);
    expect(res.status).toBe(DeliveryActionStatus.FAILED);
    expect(sut.updates.at(-1)?.['executionError']).toBe('Delhivery 503');
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
  it('is recorded FAILED with the reason', async () => {
    const sut = makeSut({ stale: '[DELIVERY_ACTION_NOT_APPLICABLE] delivered' });
    const res = await sut.svc.approve('staff1', 'req1', null, CTX);
    expect(res.status).toBe(DeliveryActionStatus.FAILED);
    expect(sut.recordFailure).toHaveBeenCalledWith(
      'req1',
      '[DELIVERY_ACTION_NOT_APPLICABLE] delivered',
    );
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
