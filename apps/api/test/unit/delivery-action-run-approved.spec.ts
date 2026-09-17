import { DeliveryActionKind, DeliveryActionStatus, OrderStatus } from '@skydrop/db';
import { DeliveryActionService } from '../../src/modules/delivery-action/services/delivery-action.service';
import { SellerStoreActionDecisionService } from '../../src/modules/delivery-action/services/seller-store-action-decision.service';

type AnyArgs = Record<string, unknown>;

/**
 * 2026-09-17 — carrying out an APPROVED request.
 *
 * Pins the four findings this change fixed: an approved recall opens the
 * SAME ticket a direct recall opens; a request that no longer applies runs
 * nothing and lands FAILED; a throw is recorded, never left APPROVED; and
 * seller staff's approval emails the store the TRUE outcome, after it ran.
 */

const CTX = { ipAddress: null, userAgent: null, requestId: null } as never;

function makeService(
  opts: {
    action?: DeliveryActionKind;
    orderStatus?: OrderStatus;
    liveShipmentId?: string;
    status?: DeliveryActionStatus;
    ticketThrows?: boolean;
    courierRefuses?: boolean;
  } = {},
) {
  const row: AnyArgs = {
    id: 'req1',
    action: opts.action ?? DeliveryActionKind.RECALL,
    reason: 'Customer says the flat number was wrong',
    orderId: 'o1',
    sellerId: 's1',
    shipmentId: 'sh1',
    status: opts.status ?? DeliveryActionStatus.APPROVED,
    resellerStoreId: 'store1',
    requestedById: 'su1',
    decisionNote: 'ok',
    decidedAt: null,
    executedAt: null,
    executionRef: null,
    executionError: null,
    createdAt: new Date('2026-09-17T00:00:00Z'),
  };
  const updateMany = jest.fn(async (args: { where: AnyArgs; data: AnyArgs }) => {
    if (args.where['status'] === row['status']) Object.assign(row, args.data);
    return { count: 1 };
  });
  const update = jest.fn(async (args: { data: AnyArgs }) => Object.assign(row, args.data));
  const client: AnyArgs = {
    orderDeliveryActionRequest: {
      findUnique: async () => row,
      findUniqueOrThrow: async () => row,
      updateMany,
      update,
    },
    order: {
      findFirst: async () => ({
        status: opts.orderStatus ?? OrderStatus.DELIVERY_FAILED,
        orderShipments: [{ shipmentId: opts.liveShipmentId ?? 'sh1' }],
      }),
    },
    shipment: { findUniqueOrThrow: async () => ({ id: 'sh1', awbNumber: 'AWB1' }) },
  };
  const enqueueAgain = jest.fn(async () => ({ created: true }));
  const openTicket = jest.fn(async () => {
    if (opts.ticketThrows) throw new Error('ticket store down');
    return { id: 'tkt1' };
  });
  const cancelWithCourier = jest.fn(async () =>
    opts.courierRefuses
      ? { success: false, awbNumber: 'AWB1', message: 'Already out for delivery' }
      : { success: true, awbNumber: 'AWB1', message: null },
  );
  const svc = new DeliveryActionService(
    { client } as never,
    { log: jest.fn(async () => 'a1') } as never,
    { enqueueAgain } as never,
    { cancelWithCourier } as never,
    { raise: jest.fn(async () => null) } as never,
    { open: openTicket } as never,
    { openForTicket: jest.fn(async () => ({ id: 'e1' })), postReply: jest.fn() } as never,
  );
  return { svc, row, enqueueAgain, openTicket, cancelWithCourier, updateMany };
}

describe('DeliveryActionService.runApproved', () => {
  it('an approved recall opens the ticket a direct recall opens, and queues the call as the STORE', async () => {
    const sut = makeService();
    const out = await sut.svc.runApproved('req1', CTX);
    expect(sut.openTicket).toHaveBeenCalledTimes(1);
    expect(sut.enqueueAgain).toHaveBeenCalledWith('o1', expect.any(Date), undefined, 'STORE_ASKED');
    expect(out.status).toBe(DeliveryActionStatus.EXECUTED);
    expect(out.executionRef).toBe('tkt1');
  });

  it('a send-back approved after the parcel was delivered calls no courier and lands FAILED', async () => {
    const sut = makeService({
      action: DeliveryActionKind.RTO,
      orderStatus: OrderStatus.DELIVERED,
    });
    const out = await sut.svc.runApproved('req1', CTX);
    expect(sut.cancelWithCourier).not.toHaveBeenCalled();
    expect(out.status).toBe(DeliveryActionStatus.FAILED);
    expect(out.executionError).toContain('DELIVERY_ACTION_NOT_APPLICABLE');
  });

  it('a request about a parcel that is no longer the live one runs nothing', async () => {
    const sut = makeService({ liveShipmentId: 'sh2' });
    const out = await sut.svc.runApproved('req1', CTX);
    expect(sut.openTicket).not.toHaveBeenCalled();
    expect(out.status).toBe(DeliveryActionStatus.FAILED);
  });

  it('a throw while carrying it out is recorded FAILED, never left APPROVED', async () => {
    const sut = makeService({ ticketThrows: true });
    const out = await sut.svc.runApproved('req1', CTX);
    expect(out.status).toBe(DeliveryActionStatus.FAILED);
    expect(out.executionError).toContain('ticket store down');
  });

  it('a courier refusal keeps seller staff’s own note', async () => {
    const sut = makeService({ action: DeliveryActionKind.RTO, courierRefuses: true });
    const out = await sut.svc.runApproved('req1', CTX);
    expect(out.status).toBe(DeliveryActionStatus.FAILED);
    expect(out.decisionNote).toBe('ok');
    expect(out.executionError).toContain('Already out for delivery');
  });

  it('only an APPROVED request is carried out', async () => {
    const sut = makeService({ status: DeliveryActionStatus.EXECUTED });
    await sut.svc.runApproved('req1', CTX);
    expect(sut.openTicket).not.toHaveBeenCalled();
  });
});

function makeDecision(opts: { claimed?: number; runStatus?: DeliveryActionStatus } = {}) {
  const calls: string[] = [];
  const row = {
    id: 'req1',
    action: DeliveryActionKind.RTO,
    orderId: 'o1',
    reason: 'wrong address',
    decisionNote: null,
    resellerStoreId: 'store1',
  };
  const updateMany = jest.fn(async () => ({ count: opts.claimed ?? 1 }));
  const client = {
    orderDeliveryActionRequest: {
      updateMany,
      findUniqueOrThrow: async () => row,
    },
    order: {
      findUnique: async () => ({ orderNumber: 'SD-1', seller: { companyName: 'Acme' } }),
    },
  };
  const runApproved = jest.fn(async () => {
    calls.push('run');
    return {
      id: 'req1',
      status: opts.runStatus ?? DeliveryActionStatus.EXECUTED,
      executionError:
        opts.runStatus === DeliveryActionStatus.FAILED ? 'Courier refused: nope' : null,
    };
  });
  const decided = jest.fn(async () => {
    calls.push('email');
  });
  const svc = new SellerStoreActionDecisionService(
    { client } as never,
    { log: jest.fn(async () => 'a1') } as never,
    { runApproved, toView: (r: unknown) => r } as never,
    { decided } as never,
  );
  return { svc, calls, runApproved, decided, updateMany };
}

const SELLER = { id: 's1', userId: 'su-seller' } as never;

describe('SellerStoreActionDecisionService (Seller staff deciding a store’s delivery ask)', () => {
  it('approve RUNS it first and then emails the store the true outcome', async () => {
    const sut = makeDecision();
    const out = await sut.svc.approve(SELLER, 'req1', null, CTX);
    expect(sut.calls).toEqual(['run', 'email']);
    expect(out.status).toBe(DeliveryActionStatus.EXECUTED);
    expect(sut.decided).toHaveBeenCalledWith(
      expect.objectContaining({ approved: true, carriedOut: true }),
    );
  });

  it('a failure is FAILED and the store is told it could not be carried out, with why', async () => {
    const sut = makeDecision({ runStatus: DeliveryActionStatus.FAILED });
    const out = await sut.svc.approve(SELLER, 'req1', null, CTX);
    expect(out.status).toBe(DeliveryActionStatus.FAILED);
    expect(sut.decided).toHaveBeenCalledWith(
      expect.objectContaining({
        approved: true,
        carriedOut: false,
        outcome: expect.stringContaining('Courier refused: nope'),
      }),
    );
  });

  it('the claim is guarded on PENDING + held for this seller; a lost race is ALREADY_DECIDED and runs nothing', async () => {
    const sut = makeDecision({ claimed: 0 });
    await expect(sut.svc.approve(SELLER, 'req1', null, CTX)).rejects.toMatchObject({
      response: { code: 'DELIVERY_ACTION_ALREADY_DECIDED' },
    });
    expect(sut.runApproved).not.toHaveBeenCalled();
    expect(sut.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          sellerId: 's1',
          needsSellerApproval: true,
          status: DeliveryActionStatus.PENDING,
        }),
      }),
    );
  });

  it('reject runs nothing and tells the store', async () => {
    const sut = makeDecision();
    await sut.svc.reject(SELLER, 'req1', 'Customer already moved');
    expect(sut.runApproved).not.toHaveBeenCalled();
    expect(sut.decided).toHaveBeenCalledWith(expect.objectContaining({ approved: false }));
  });
});
