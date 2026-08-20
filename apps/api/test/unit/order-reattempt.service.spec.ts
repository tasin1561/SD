import { OrderStatus, ReattemptRequestStatus } from '@skydrop/db';
import { OrderReattemptService } from '../../src/modules/order-reattempt/services/order-reattempt.service';

/**
 * The one path out of REJECTED_BY_CUSTOMER.
 *
 * A request, not a right: the customer said no, and a seller who could
 * requeue that unaided is a seller who can have somebody rung repeatedly
 * after they refused. These pin the properties that make the approval
 * safe — it cannot be double-applied, and it cannot leave a request
 * reading APPROVED over an order that never moved.
 */
describe('OrderReattemptService', () => {
  const PENDING_ROW: {
    id: string;
    orderId: string;
    sellerId: string;
    reason: string;
    status: ReattemptRequestStatus;
    extraAttempts: number;
    decisionNote: string | null;
    decidedAt: Date | null;
    orderStatusAtRequest: string;
    createdAt: Date;
  } = {
    id: 'r1',
    orderId: 'o1',
    sellerId: 's1',
    reason: 'Customer messaged after the call; the agent quoted the wrong price',
    status: ReattemptRequestStatus.PENDING,
    extraAttempts: 0,
    decisionNote: null,
    decidedAt: null,
    orderStatusAtRequest: OrderStatus.REJECTED_BY_CUSTOMER,
    createdAt: new Date(),
  };

  function make(opts: { row?: typeof PENDING_ROW | null; transitionThrows?: boolean } = {}) {
    const findUnique = jest.fn().mockResolvedValue(opts.row === undefined ? PENDING_ROW : opts.row);
    const updateMany = jest.fn().mockResolvedValue({ count: 1 });
    const log = jest.fn().mockResolvedValue('a1');
    // Typed with its argument so `mock.calls[0][0]` is readable — an
    // arg-less jest.fn has an EMPTY tuple for calls.
    const transitionStatus = jest.fn(
      async (_input: { orderId: string; to: OrderStatus; expectedFrom?: OrderStatus }) => {
        if (opts.transitionThrows === true) throw new Error('order moved under us');
        return { orderId: 'o1', status: OrderStatus.PENDING_CONFIRMATION };
      },
    );
    const svc = new OrderReattemptService(
      { client: { orderReattemptRequest: { findUnique, updateMany, create: jest.fn() } } } as never,
      { log } as never,
      {} as never,
      { transitionStatus, canTransition: () => true } as never,
      // Which statuses qualify is a per-seller setting; the default
      // names REJECTED_BY_CUSTOMER and these tests are about the
      // approval, not the list.
      {
        resolve: jest.fn(async () => ({ value: ['REJECTED_BY_CUSTOMER'] })),
      } as never,
    );
    return { svc, updateMany, transitionStatus, log };
  }

  it('claims the request BEFORE transitioning — the double-approve guard', async () => {
    const { svc, updateMany } = make();
    await svc.approve('r1', 'staff-1', 'ok', 1);
    // Guarded on still-PENDING: without it two admins both read PENDING
    // and both put the order back in the queue.
    expect(updateMany.mock.calls[0]?.[0].where).toEqual({
      id: 'r1',
      status: ReattemptRequestStatus.PENDING,
    });
  });

  it('409s when another admin decided first', async () => {
    const { svc, updateMany, transitionStatus } = make();
    updateMany.mockResolvedValueOnce({ count: 0 });
    await expect(svc.approve('r1', 'staff-1', null, 1)).rejects.toMatchObject({
      response: { code: 'REQUEST_ALREADY_DECIDED' },
    });
    // The order must not move on a lost race.
    expect(transitionStatus).not.toHaveBeenCalled();
  });

  it('guards on the status the request was RAISED from, not a fixed one', async () => {
    // Hardcoding REJECTED_BY_CUSTOMER broke every NDR approval the
    // moment that status was enabled in settings: ask, read, approve —
    // 409 STALE_ORDER_STATUS, with nothing on screen explaining why.
    const ndr = make({
      row: { ...PENDING_ROW, orderStatusAtRequest: OrderStatus.REJECTED_NDR },
    });
    await ndr.svc.approve('r1', 'staff-1', null, 1);
    expect(ndr.transitionStatus.mock.calls[0]?.[0]?.expectedFrom).toBe(OrderStatus.REJECTED_NDR);
  });

  it('guards the transition on the order still being REJECTED_BY_CUSTOMER', async () => {
    const { svc, transitionStatus } = make();
    await svc.approve('r1', 'staff-1', null, 1);
    const arg = transitionStatus.mock.calls[0]?.[0];
    expect(arg).toBeDefined();
    // A god-mode edit since the request was raised means the decision
    // was made about a different situation.
    expect(arg?.expectedFrom).toBe(OrderStatus.REJECTED_BY_CUSTOMER);
    expect(arg?.to).toBe(OrderStatus.PENDING_CONFIRMATION);
  });

  it('ROLLS BACK the approval when the order cannot be requeued', async () => {
    // The silent failure this prevents: a request reading APPROVED over
    // an order still sitting rejected. Nobody would ever look again.
    const { svc, updateMany } = make({ transitionThrows: true });
    await expect(svc.approve('r1', 'staff-1', 'ok', 1)).rejects.toThrow('order moved under us');

    const compensate = updateMany.mock.calls[1]?.[0];
    expect(compensate.where).toEqual({ id: 'r1', status: ReattemptRequestStatus.APPROVED });
    expect(compensate.data.status).toBe(ReattemptRequestStatus.PENDING);
    expect(compensate.data.decidedById).toBeNull();
  });

  it('records the granted headroom on the request', async () => {
    // Unlocking the queue is not enough: without headroom the order
    // comes back already at its cap, and the next unanswered ring
    // re-rejects it — the whole approval spent on somebody not in.
    const { svc, updateMany } = make();
    await svc.approve('r1', 'staff-1', 'ok', 2);
    expect(updateMany.mock.calls[0]?.[0].data.extraAttempts).toBe(2);
  });

  it('clears the grant when the approval rolls back', async () => {
    const { svc, updateMany } = make({ transitionThrows: true });
    await expect(svc.approve('r1', 'staff-1', 'ok', 3)).rejects.toThrow();
    // Leaving it set would quietly raise the cap on an order that never
    // returned to the queue.
    expect(updateMany.mock.calls[1]?.[0].data.extraAttempts).toBe(0);
  });

  describe('which statuses may be asked about', () => {
    function capable(configured: string[], canTransition = true) {
      const svc = new OrderReattemptService(
        { client: { orderReattemptRequest: {} } } as never,
        { log: jest.fn() } as never,
        {} as never,
        { canTransition: () => canTransition } as never,
        { resolve: jest.fn(async () => ({ value: configured })) } as never,
      );
      return svc;
    }

    it('reads the per-seller setting', async () => {
      const svc = capable(['REJECTED_BY_CUSTOMER', 'REJECTED_NDR']);
      expect(await svc.requestableStatuses('s1')).toEqual([
        OrderStatus.REJECTED_BY_CUSTOMER,
        OrderStatus.REJECTED_NDR,
      ]);
    });

    it('IGNORES a status the state machine cannot leave', async () => {
      // The safety property. A list naming a status with no edge back to
      // PENDING_CONFIRMATION would give the seller a button whose
      // approval then 409s — a control that looks like it works.
      const svc = capable(['REJECTED_BY_CUSTOMER'], false);
      expect(await svc.requestableStatuses('s1')).toEqual([]);
    });

    it('ignores a value that is not an OrderStatus at all', async () => {
      const svc = capable(['REJECTED_BY_CUSTOMER', 'NOT_A_STATUS', 42 as never]);
      expect(await svc.requestableStatuses('s1')).toEqual([OrderStatus.REJECTED_BY_CUSTOMER]);
    });

    it('falls back to the default when the setting is missing', async () => {
      const svc = new OrderReattemptService(
        { client: { orderReattemptRequest: {} } } as never,
        { log: jest.fn() } as never,
        {} as never,
        { canTransition: () => true } as never,
        { resolve: jest.fn(async () => ({ value: null })) } as never,
      );
      // A settings outage must not silently withdraw the one status the
      // flow was built for.
      expect(await svc.requestableStatuses('s1')).toEqual([OrderStatus.REJECTED_BY_CUSTOMER]);
    });
  });

  it('audits an approval at MEDIUM — it rings someone who said no', async () => {
    const { svc, log } = make();
    await svc.approve('r1', 'staff-1', 'seller has a message from them', 1);
    const entry = log.mock.calls[0]?.[0];
    expect(entry.action).toBe('order.reattempt_approved');
    expect(entry.severity).toBe('MEDIUM');
  });

  it('rejecting never touches the order', async () => {
    const { svc, transitionStatus } = make();
    await svc.reject('r1', 'staff-1', 'customer was clear');
    expect(transitionStatus).not.toHaveBeenCalled();
  });

  it('refuses a request that is already decided', async () => {
    const { svc } = make({ row: { ...PENDING_ROW, status: ReattemptRequestStatus.APPROVED } });
    await expect(svc.approve('r1', 'staff-1', null, 1)).rejects.toMatchObject({
      response: { code: 'REQUEST_ALREADY_DECIDED' },
    });
  });
});
