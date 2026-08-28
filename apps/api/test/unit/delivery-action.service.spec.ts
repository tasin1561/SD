import { DeliveryActionKind, DeliveryActionStatus, OrderStatus } from '@skydrop/db';
import { DeliveryActionService } from '../../src/modules/delivery-action/services/delivery-action.service';
import type { PrismaService } from '../../src/infrastructure/prisma/prisma.service';
import type { AuditLogService } from '../../src/modules/auth-common/services/audit-log.service';
import type { CallQueueService } from '../../src/modules/call-queue/services/call-queue.service';

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

  const client: AnyArgs = {
    order: { findFirst: async () => order },
    orderDeliveryActionRequest: {
      findFirst: async () => opts.openRequest ?? null,
      findMany: async () => [],
      create: async (args: { data: AnyArgs }) => {
        created.push(args.data);
        return {
          id: 'req1',
          ...args.data,
          status: DeliveryActionStatus.PENDING,
          decisionNote: null,
          decidedAt: null,
          executedAt: null,
          executionRef: null,
          executionError: null,
          createdAt: new Date('2026-08-28T00:00:00Z'),
        };
      },
      update: async () => ({}),
    },
    deliveryAttempt: { findFirst: async () => opts.attempt ?? { id: 'att1' } },
  };

  const prisma = { client } as unknown as PrismaService;
  const audit = { log: jest.fn(async () => 'a1') } as unknown as AuditLogService;
  const queue = { enqueueAgain } as unknown as CallQueueService;

  return { svc: new DeliveryActionService(prisma, audit, queue), created, enqueueAgain };
}

const BASE = {
  sellerId: 's1',
  sellerUserId: 'u1',
  orderId: 'o1',
  action: DeliveryActionKind.REATTEMPT,
  reason: 'Customer called us, they were at work all day',
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
