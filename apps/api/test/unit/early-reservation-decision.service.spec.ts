import { EarlyReservationReviewStatus, OrderStatus } from '@skydrop/db';
import { EarlyReservationDecisionService } from '../../src/modules/early-reservation-decision/services/early-reservation-decision.service';
import type { EarlyReservationReviewService } from '../../src/modules/early-reservation/services/early-reservation-review.service';
import type { OrderWriteService } from '../../src/modules/order/services/order-write.service';

type AnyArgs = Record<string, unknown>;

const SELLER = 'seller-1';
const REVIEW = 'review-1';
const ORDER = 'order-1';
const USER = 'su-1';

function makeSut(
  opts: { decideThrows?: boolean; transitionThrows?: boolean } = {},
) {
  const decide = jest.fn<Promise<AnyArgs>, [string, string, string, string, string | null]>(
    async (_s, _r, decision) => {
      if (opts.decideThrows) {
        throw Object.assign(new Error('conflict'), {
          response: { code: 'REVIEW_ALREADY_RESOLVED' },
        });
      }
      return {
        id: REVIEW,
        orderId: ORDER,
        status:
          decision === 'RELEASE'
            ? EarlyReservationReviewStatus.SELLER_RELEASED
            : EarlyReservationReviewStatus.SELLER_REQUESTED_MORE_ATTEMPTS,
        attemptCount: 3,
        heldQty: 5,
        note: null,
        resolvedAt: new Date(),
        createdAt: new Date(),
      };
    },
  );
  const listForSeller = jest.fn<Promise<AnyArgs[]>, [string, string?]>(async () => []);
  const reviews = { decide, listForSeller };

  const transitionStatus = jest.fn<Promise<AnyArgs>, [AnyArgs]>(async (args) => {
    if (opts.transitionThrows) throw new Error('stale order status');
    return { orderId: ORDER, status: args['to'] };
  });
  const orderWrite = { transitionStatus };

  return {
    svc: new EarlyReservationDecisionService(
      reviews as unknown as EarlyReservationReviewService,
      orderWrite as unknown as OrderWriteService,
    ),
    decide,
    listForSeller,
    transitionStatus,
  };
}

describe('EarlyReservationDecisionService.decide', () => {
  it('REQUEST_MORE_ATTEMPTS puts the order back in the call queue', async () => {
    const sut = makeSut();
    const r = await sut.svc.decide(SELLER, REVIEW, 'REQUEST_MORE_ATTEMPTS', USER);
    expect(r.orderMoved).toBe(true);
    expect(r.orderStatus).toBe(OrderStatus.PENDING_CONFIRMATION);
    expect(sut.transitionStatus.mock.calls[0]![0]).toMatchObject({
      orderId: ORDER,
      to: OrderStatus.PENDING_CONFIRMATION,
      // Guarded: only an order still parked can be moved by a decision.
      expectedFrom: OrderStatus.AWAITING_SELLER_DECISION,
    });
  });

  it('RELEASE lands the NDR terminal', async () => {
    const sut = makeSut();
    const r = await sut.svc.decide(SELLER, REVIEW, 'RELEASE', USER);
    expect(r.orderStatus).toBe(OrderStatus.REJECTED_NDR);
  });

  it('records the decision BEFORE moving the order (durable-first ordering)', async () => {
    const sut = makeSut();
    const order: string[] = [];
    sut.decide.mockImplementation(async () => {
      order.push('review');
      return {
        id: REVIEW,
        orderId: ORDER,
        status: EarlyReservationReviewStatus.SELLER_RELEASED,
        attemptCount: 3,
        heldQty: 0,
        note: null,
        resolvedAt: new Date(),
        createdAt: new Date(),
      };
    });
    sut.transitionStatus.mockImplementation(async (args) => {
      order.push('transition');
      return { orderId: ORDER, status: args['to'] };
    });
    await sut.svc.decide(SELLER, REVIEW, 'RELEASE', USER);
    expect(order).toEqual(['review', 'transition']);
  });

  it('a rejected review (already resolved) never touches the order', async () => {
    const sut = makeSut({ decideThrows: true });
    await expect(
      sut.svc.decide(SELLER, REVIEW, 'RELEASE', USER),
    ).rejects.toMatchObject({ response: { code: 'REVIEW_ALREADY_RESOLVED' } });
    expect(sut.transitionStatus).not.toHaveBeenCalled();
  });

  it('a failed transition still reports the recorded decision instead of erroring', async () => {
    // The order may have legitimately moved on (admin cancel, god mode).
    // The seller's answer is already durable, so the request succeeded in
    // the way that matters.
    const sut = makeSut({ transitionThrows: true });
    const r = await sut.svc.decide(SELLER, REVIEW, 'RELEASE', USER);
    expect(r.orderMoved).toBe(false);
    expect(r.orderStatus).toBeNull();
    expect(r.review.status).toBe(EarlyReservationReviewStatus.SELLER_RELEASED);
  });

  it('listOpen asks only for OPEN reviews', async () => {
    const sut = makeSut();
    await sut.svc.listOpen(SELLER);
    expect(sut.listForSeller).toHaveBeenCalledWith(
      SELLER,
      EarlyReservationReviewStatus.OPEN,
    );
  });
});
