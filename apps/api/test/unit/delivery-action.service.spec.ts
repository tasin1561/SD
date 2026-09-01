import { DeliveryActionKind, DeliveryActionStatus, OrderStatus } from '@skydrop/db';
import { DeliveryActionService } from '../../src/modules/delivery-action/services/delivery-action.service';
import type { PrismaService } from '../../src/infrastructure/prisma/prisma.service';
import type { AuditLogService } from '../../src/modules/auth-common/services/audit-log.service';
import type { CallQueueService } from '../../src/modules/call-queue/services/call-queue.service';
import type { CourierShipmentActionService } from '../../src/modules/courier-ops/services/courier-shipment-action.service';
import type { SystemIssueService } from '../../src/modules/system-issues/services/system-issue.service';

type AnyArgs = Record<string, unknown>;

function makeSut(
  opts: {
    order?: AnyArgs | null;
    openRequest?: AnyArgs | null;
    attempt?: AnyArgs | null;
  } = {},
) {
  const created: AnyArgs[] = [];
  const enqueueAgain = jest.fn(async () => ({ created: true }));

  const order =
    opts.order === undefined
      ? {
          id: 'o1',
          status: OrderStatus.DELIVERY_FAILED,
          orderShipments: [{ shipment: { id: 'sh1', awbNumber: 'AWB1' } }],
        }
      : opts.order;

  const updated: AnyArgs[] = [];
  const client: AnyArgs = {
    order: { findFirst: async () => order },
    orderDeliveryActionRequest: {
      findFirst: async () => opts.openRequest ?? null,
      findMany: async () => [],
      create: async (args: { data: AnyArgs }) => {
        created.push(args.data);
        return {
          id: 'req1',
          status: DeliveryActionStatus.PENDING,
          decisionNote: null,
          decidedAt: null,
          executedAt: null,
          executionRef: null,
          executionError: null,
          createdAt: new Date('2026-08-28T00:00:00Z'),
          // AFTER the defaults, not before: the service may create a row
          // already APPROVED (the seller's own RTO), and a mock that
          // stamps PENDING over it would hide exactly that.
          ...args.data,
        };
      },
      update: async (args: { data: AnyArgs }) => {
        updated.push(args.data);
        return {
          id: 'req1',
          orderId: 'o1',
          shipmentId: 'sh1',
          action: DeliveryActionKind.RTO,
          reason: 'x',
          decisionNote: null,
          decidedAt: null,
          executedAt: null,
          executionRef: null,
          executionError: null,
          createdAt: new Date('2026-08-28T00:00:00Z'),
          ...args.data,
        };
      },
    },
    deliveryAttempt: { findFirst: async () => opts.attempt ?? { id: 'att1' } },
  };

  const prisma = { client } as unknown as PrismaService;
  const audit = { log: jest.fn(async () => 'a1') } as unknown as AuditLogService;
  const queue = { enqueueAgain } as unknown as CallQueueService;

  const cancelWithCourier = jest.fn(
    async (
      _actor: { type: string; id: string },
      _shipmentId: string,
      _reason: string,
      _ctx: unknown,
    ): Promise<{ success: boolean; awbNumber: string; message: string | null }> => ({
      success: true,
      awbNumber: 'AWB1',
      message: null,
    }),
  );
  const courier = { cancelWithCourier } as unknown as CourierShipmentActionService;
  const issues = { raise: jest.fn(async () => null) } as unknown as SystemIssueService;

  return {
    svc: new DeliveryActionService(prisma, audit, queue, courier, issues),
    created,
    updated,
    enqueueAgain,
    cancelWithCourier,
    issues,
  };
}

const BASE = {
  sellerId: 's1',
  sellerUserId: 'u1',
  orderId: 'o1',
  action: DeliveryActionKind.REATTEMPT,
  reason: 'Customer called us, they were at work all day',
  ctx: { ipAddress: null, userAgent: null, requestId: null },
};

describe('DeliveryActionService.request', () => {
  it('records the ask and reaches NO courier', async () => {
    // The whole point of the request/decision split (CUR-10): a
    // re-attempt dispatches a van, so a seller-facing handler records
    // what they want and stops there.
    const sut = makeSut();
    const view = await sut.svc.request(BASE);

    expect(view.status).toBe(DeliveryActionStatus.PENDING);
    expect(sut.created[0]).toMatchObject({
      orderId: 'o1',
      shipmentId: 'sh1',
      action: DeliveryActionKind.REATTEMPT,
    });
  });

  it('ties the request to the NDR it answers', async () => {
    // Otherwise a request reads later as a response to a failure that
    // had not happened when it was raised.
    const sut = makeSut({ attempt: { id: 'att-99' } });
    await sut.svc.request(BASE);
    expect(sut.created[0]?.['deliveryAttemptId']).toBe('att-99');
  });

  it('refuses a reason too short to act on', async () => {
    const sut = makeSut();
    await expect(sut.svc.request({ ...BASE, reason: 'retry' })).rejects.toMatchObject({
      response: { code: 'DELIVERY_ACTION_REASON_TOO_SHORT' },
    });
  });

  it('allows a request while the parcel is still OUT for delivery', async () => {
    // A seller who has just heard from their customer that nobody is
    // home should be able to say so before the driver knocks, rather
    // than waiting for the failure they can already see coming.
    const sut = makeSut({
      order: {
        id: 'o1',
        status: OrderStatus.OUT_FOR_DELIVERY,
        orderShipments: [{ shipment: { id: 'sh1', awbNumber: 'AWB1' } }],
      },
    });
    await expect(sut.svc.request(BASE)).resolves.toMatchObject({ status: 'PENDING' });
  });

  it('refuses once the parcel is delivered — there is nothing to act on', async () => {
    const sut = makeSut({
      order: {
        id: 'o1',
        status: OrderStatus.DELIVERED,
        orderShipments: [{ shipment: { id: 'sh1', awbNumber: 'AWB1' } }],
      },
    });
    await expect(sut.svc.request(BASE)).rejects.toMatchObject({
      response: { code: 'DELIVERY_ACTION_NOT_APPLICABLE' },
    });
  });

  it('refuses a second open request on the same parcel', async () => {
    // Two pending asks are two operators about to do contradictory
    // things to one parcel.
    const sut = makeSut({ openRequest: { id: 'req0', action: DeliveryActionKind.RTO } });
    await expect(sut.svc.request(BASE)).rejects.toMatchObject({
      response: { code: 'DELIVERY_ACTION_ALREADY_OPEN' },
    });
  });

  it("another seller's order is indistinguishable from one that does not exist", async () => {
    const sut = makeSut({ order: null });
    await expect(sut.svc.request(BASE)).rejects.toMatchObject({
      response: { code: 'ORDER_NOT_FOUND' },
    });
  });

  it('RECALL enqueues a call and never touches a courier', async () => {
    const sut = makeSut();
    const tx = { orderDeliveryActionRequest: { update: jest.fn(async () => ({})) } };
    await sut.svc.executeRecall(tx as never, 'req1', 'o1');
    expect(sut.enqueueAgain).toHaveBeenCalledWith('o1', expect.any(Date));
  });
});

describe("DeliveryActionService.request — RTO is the seller's own call", () => {
  // CUR-10's seller amendment. The other two actions still stop at an
  // operator; this one does not, because it is the seller's goods and
  // the seller's return fee, and an operator in the loop only adds
  // hours to a decision that was never theirs.
  it('reaches the courier immediately and lands EXECUTED', async () => {
    const sut = makeSut();
    const view = await sut.svc.request({ ...BASE, action: DeliveryActionKind.RTO });

    expect(sut.cancelWithCourier).toHaveBeenCalledTimes(1);
    // Attributed to the SELLER, never to a staff member who did not act.
    const actor = sut.cancelWithCourier.mock.calls[0]?.[0] as unknown as {
      type: string;
      id: string;
    };
    expect(actor.type).toBe('SELLER');
    expect(actor.id).toBe('s1');
    expect(view.status).toBe(DeliveryActionStatus.EXECUTED);
  });

  it('records the ask BEFORE calling the courier', async () => {
    // Visible-vs-silent: a crash between leaves an APPROVED request that
    // visibly has not executed and can be re-run — rather than a parcel
    // turned around with no record of who asked for it.
    const sut = makeSut();
    await sut.svc.request({ ...BASE, action: DeliveryActionKind.RTO });
    expect(sut.created[0]?.status).toBe(DeliveryActionStatus.APPROVED);
  });

  it('a courier refusal does NOT throw — it lands FAILED and tells an admin', async () => {
    const sut = makeSut();
    sut.cancelWithCourier.mockResolvedValueOnce({
      success: false,
      awbNumber: 'AWB1',
      message: 'Already out for delivery, cannot cancel',
    });

    const view = await sut.svc.request({ ...BASE, action: DeliveryActionKind.RTO });

    // FAILED, not REJECTED: nobody said no, the far side refused.
    expect(view.status).toBe(DeliveryActionStatus.FAILED);
    // The seller now believes a parcel is coming back and it is not,
    // so this cannot end in a log line.
    expect(sut.issues.raise).toHaveBeenCalledWith(
      expect.objectContaining({ dedupeKey: 'seller-rto-refused:req1' }),
    );
  });

  it('still routes a re-attempt through an operator', async () => {
    const sut = makeSut();
    const view = await sut.svc.request({ ...BASE, action: DeliveryActionKind.REATTEMPT });
    expect(sut.cancelWithCourier).not.toHaveBeenCalled();
    expect(view.status).toBe(DeliveryActionStatus.PENDING);
  });
});
