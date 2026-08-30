import { BadRequestException, ConflictException } from '@nestjs/common';
import { ActorType, OrderStatus } from '@skydrop/db';
import { CustomerReturnService } from '../../src/modules/customer-return/services/customer-return.service';
import type { PrismaService } from '../../src/infrastructure/prisma/prisma.service';
import type { OrderWriteService } from '../../src/modules/order/services/order-write.service';
import type { AuditLogService } from '../../src/modules/auth-common/services/audit-log.service';

type AnyArgs = Record<string, unknown>;

function makeService(order: AnyArgs | null) {
  const findFirst = jest.fn<Promise<AnyArgs | null>, [AnyArgs]>(async () => order);
  const update = jest.fn<Promise<AnyArgs>, [AnyArgs]>(async () => ({}));
  const transitionStatus = jest.fn<Promise<AnyArgs>, [AnyArgs]>(async () => ({
    status: OrderStatus.RTO_INITIATED,
  }));
  const log = jest.fn(async () => 'a1');

  const svc = new CustomerReturnService(
    { client: { order: { findFirst, update } } } as unknown as PrismaService,
    { transitionStatus } as unknown as OrderWriteService,
    { log } as unknown as AuditLogService,
  );
  return { svc, findFirst, update, transitionStatus, log };
}

const DELIVERED = {
  id: 'o1',
  orderNumber: 'SD-1',
  status: OrderStatus.DELIVERED,
  sellerId: 'seller-1',
  customerReturnRequestedAt: null,
};

const INPUT = {
  orderId: 'o1',
  sellerId: 'seller-1',
  reason: 'Customer says it arrived damaged',
  actorType: ActorType.SELLER,
  actorId: 'seller-1',
};

/**
 * A customer return is not an RTO. RTO is the courier failing to
 * deliver; this starts from DELIVERED, where the customer HAS the goods
 * and is sending them back — a second delivery, priced like one.
 */
describe('CustomerReturnService', () => {
  it('moves a delivered order onto the RTO path and marks WHY', async () => {
    const { svc, update, transitionStatus } = makeService({ ...DELIVERED });
    const r = await svc.request(INPUT);

    // The mark carries the price: without it the fee at receipt would
    // be the small RTO one rather than a second delivery.
    expect((update.mock.calls[0]?.[0] as AnyArgs).data).toMatchObject({
      customerReturnReason: 'Customer says it arrived damaged',
    });
    expect((transitionStatus.mock.calls[0]?.[0] as AnyArgs).to).toBe(OrderStatus.RTO_INITIATED);
    expect(r.alreadyRequested).toBe(false);
  });

  it('marks BEFORE it transitions, so a crash between reads correctly', async () => {
    const order: AnyArgs = { ...DELIVERED };
    const { svc, update, transitionStatus } = makeService(order);
    const seen: string[] = [];
    update.mockImplementation(async () => {
      seen.push('mark');
      return {};
    });
    transitionStatus.mockImplementation(async () => {
      seen.push('transition');
      return { status: OrderStatus.RTO_INITIATED };
    });

    await svc.request(INPUT);

    // Marked-but-DELIVERED reads as "asked for, not yet moving" and
    // converges. The reverse leaves an order in RTO_INITIATED that
    // nobody can explain and that prices as a courier RTO.
    expect(seen).toEqual(['mark', 'transition']);
  });

  it('guards the transition on DELIVERED, so a concurrent move cannot be relabelled', async () => {
    const { svc, transitionStatus } = makeService({ ...DELIVERED });
    await svc.request(INPUT);
    expect((transitionStatus.mock.calls[0]?.[0] as AnyArgs).expectedFrom).toBe(
      OrderStatus.DELIVERED,
    );
  });

  it('is idempotent — asking twice is a double-click, not a second return', async () => {
    const { svc, update, transitionStatus } = makeService({
      ...DELIVERED,
      customerReturnRequestedAt: new Date(),
    });
    const r = await svc.request(INPUT);

    expect(r.alreadyRequested).toBe(true);
    expect(update).not.toHaveBeenCalled();
    expect(transitionStatus).not.toHaveBeenCalled();
  });

  it('refuses an order that has not been delivered, and says what it IS', async () => {
    const { svc } = makeService({ ...DELIVERED, status: OrderStatus.IN_TRANSIT });
    // A seller looking at a parcel still moving needs to be told to
    // wait, not that something went wrong.
    await expect(svc.request(INPUT)).rejects.toBeInstanceOf(ConflictException);
  });

  it('requires a real reason — the warehouse reads it on arrival', async () => {
    const { svc } = makeService({ ...DELIVERED });
    await expect(svc.request({ ...INPUT, reason: '  x ' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('scopes to the seller IN THE QUERY', async () => {
    const { svc, findFirst } = makeService({ ...DELIVERED });
    await svc.request(INPUT);
    expect((findFirst.mock.calls[0]?.[0] as AnyArgs).where).toMatchObject({
      sellerId: 'seller-1',
    });
  });

  it('staff act across sellers', async () => {
    const { svc, findFirst } = makeService({ ...DELIVERED });
    await svc.request({ ...INPUT, sellerId: null, actorType: ActorType.STAFF, actorId: 'staff-1' });
    expect((findFirst.mock.calls[0]?.[0] as AnyArgs).where).not.toHaveProperty('sellerId');
  });
});
