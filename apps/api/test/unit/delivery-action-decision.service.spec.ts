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
  const executeRecall = jest.fn(async () => undefined);

  const client: AnyArgs = {
    orderDeliveryActionRequest: {
      updateMany: async () => ({ count: opts.claimed ?? 1 }),
      findUnique: async () => ({
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
    { executeRecall } as unknown as DeliveryActionService,
  );
  return { svc, updates, takeNdrAction, cancelWithCourier, executeRecall };
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

  it('a RECALL never touches a courier — it is our own agents', async () => {
    const sut = makeSut({ action: DeliveryActionKind.RECALL });
    const res = await sut.svc.approve('staff1', 'req1', null, CTX);
    expect(sut.executeRecall).toHaveBeenCalled();
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

describe('DeliveryActionDecisionService.reject', () => {
  it('claims on PENDING so a decided request cannot be decided twice', async () => {
    const sut = makeSut({ claimed: 0 });
    await expect(sut.svc.reject('staff1', 'req1', 'Already tried twice')).rejects.toMatchObject({
      response: { code: 'DELIVERY_ACTION_ALREADY_DECIDED' },
    });
  });
});
