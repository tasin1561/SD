import {
  EarlyReservationReviewStatus,
  StoreCallCapProposal,
  StoreOrderRequestKind,
  StoreOrderRequestStatus,
} from '@skydrop/db';
import { StoreOrderRequestService } from '../../src/modules/store-order-request/services/store-order-request.service';
import { SellerStoreOrderRequestDecisionService } from '../../src/modules/store-order-request-decision/services/seller-store-order-request-decision.service';
import { StoreRequestExpiryService } from '../../src/modules/store-order-request/services/store-request-expiry.service';

type AnyArgs = Record<string, unknown>;
const CTX = { ipAddress: null, userAgent: null, requestId: null } as never;
const SELLER = { id: 's1', userId: 'su-seller' } as never;

/**
 * 2026-09-17 — a Reseller store's held cancel / call-cap answer / issue
 * with Skydrop (owner: "if the store can do then will this will be done
 * directly or it requests to the seller"), and the reminder/expiry sweep
 * over every held queue.
 */

describe('StoreOrderRequestService.hold', () => {
  function make(open: AnyArgs | null = null) {
    const create = jest.fn(async (args: { data: AnyArgs }) => ({
      id: 'req1',
      status: StoreOrderRequestStatus.PENDING,
      decisionNote: null,
      sellerDecidedAt: null,
      executedAt: null,
      executionRef: null,
      failureReason: null,
      expiredAt: null,
      createdAt: new Date(),
      cancellationReason: null,
      callCapProposal: null,
      issueSubject: null,
      note: null,
      ...args.data,
    }));
    const tx = {
      $executeRaw: jest.fn(async () => 1),
      $queryRaw: jest.fn(async () => []),
      storeOrderRequest: { findFirst: jest.fn(async () => open), create },
    };
    const client = {
      order: {
        findFirst: async () => ({
          sellerId: 's1',
          orderNumber: 'SD-1',
          storeNameSnapshot: 'Store',
        }),
      },
      $transaction: async (fn: (t: unknown) => Promise<unknown>) => fn(tx),
    };
    const waitingOnSeller = jest.fn(async () => undefined);
    const svc = new StoreOrderRequestService(
      { client } as never,
      { log: jest.fn(async () => 'a1') } as never,
      { waitingOnSeller } as never,
    );
    return { svc, create, waitingOnSeller, tx };
  }

  it('holds a cancel and tells Seller staff', async () => {
    const sut = make();
    const out = await sut.svc.hold({
      storeId: 'st1',
      storeUserId: 'su1',
      orderId: 'o1',
      kind: StoreOrderRequestKind.CANCEL,
      note: 'Customer changed their mind',
    });
    expect(out.status).toBe(StoreOrderRequestStatus.PENDING);
    expect(sut.create).toHaveBeenCalledTimes(1);
    expect(sut.waitingOnSeller).toHaveBeenCalledWith(
      expect.objectContaining({ sellerId: 's1', label: 'call the order off' }),
    );
  });

  it('refuses a second open request of the same kind on the order', async () => {
    const sut = make({ id: 'old' });
    await expect(
      sut.svc.hold({
        storeId: 'st1',
        storeUserId: 'su1',
        orderId: 'o1',
        kind: StoreOrderRequestKind.CANCEL,
        note: 'again',
      }),
    ).rejects.toMatchObject({ response: { code: 'STORE_REQUEST_ALREADY_OPEN' } });
    expect(sut.create).not.toHaveBeenCalled();
  });

  it('a cancel or call-cap answer needs a reason for Seller staff', async () => {
    const sut = make();
    await expect(
      sut.svc.hold({
        storeId: 'st1',
        storeUserId: 'su1',
        orderId: 'o1',
        kind: StoreOrderRequestKind.CALL_CAP_DECISION,
        note: '  ',
        callCapProposal: StoreCallCapProposal.RELEASE,
      }),
    ).rejects.toMatchObject({ response: { code: 'STORE_REQUEST_REASON_REQUIRED' } });
  });
});

function makeDecision(
  opts: {
    kind?: StoreOrderRequestKind;
    claimed?: number;
    cancelThrows?: unknown;
    reviewStatus?: EarlyReservationReviewStatus | null;
  } = {},
) {
  const calls: string[] = [];
  const row: AnyArgs = {
    id: 'req1',
    orderId: 'o1',
    sellerId: 's1',
    storeId: 'st1',
    requestedByStoreUserId: 'su1',
    kind: opts.kind ?? StoreOrderRequestKind.CANCEL,
    status: StoreOrderRequestStatus.APPROVED,
    note: 'why',
    cancellationReason: null,
    callCapProposal: StoreCallCapProposal.REQUEST_MORE_ATTEMPTS,
    issueSubject: 'Crushed',
    decisionNote: null,
  };
  const updateMany = jest.fn(async (args: { where: AnyArgs; data: AnyArgs }) => {
    if (args.where['status'] === StoreOrderRequestStatus.APPROVED) {
      Object.assign(row, args.data);
      calls.push(`record:${String(args.data['status'])}`);
      return { count: 1 };
    }
    return { count: opts.claimed ?? 1 };
  });
  const client = {
    storeOrderRequest: {
      updateMany,
      findUniqueOrThrow: async () => row,
      findMany: jest.fn(async () => []),
    },
    order: {
      findFirst: async () => ({ id: 'o1' }),
      findUnique: async () => ({ orderNumber: 'SD-1', seller: { companyName: 'Acme' } }),
    },
    earlyReservationReview: {
      findFirst: async () =>
        opts.reviewStatus === null
          ? null
          : { id: 'rev1', status: opts.reviewStatus ?? EarlyReservationReviewStatus.OPEN },
    },
  };
  const cancelBySeller = jest.fn(async () => {
    calls.push('cancel');
    if (opts.cancelThrows !== undefined) throw opts.cancelThrows;
    return {};
  });
  const decideAsStore = jest.fn(async () => ({ review: {}, orderStatus: null, orderMoved: true }));
  const openStoreIssue = jest.fn(async () => ({ id: 'tkt1', ticketNumber: 'TK-2026-000001' }));
  const decided = jest.fn(async () => {
    calls.push('email');
  });
  const svc = new SellerStoreOrderRequestDecisionService(
    { client } as never,
    { log: jest.fn(async () => 'a1') } as never,
    { toView: (r: AnyArgs) => r } as never,
    { decided } as never,
    { cancelBySeller } as never,
    { decideAsStore } as never,
    { openStoreIssue } as never,
  );
  return { svc, calls, row, updateMany, cancelBySeller, decideAsStore, openStoreIssue, decided };
}

describe('SellerStoreOrderRequestDecisionService', () => {
  it('approving a cancel cancels AS THE STORE, records EXECUTED, then emails the store', async () => {
    const sut = makeDecision();
    const out = (await sut.svc.approve(SELLER, 'req1', null, CTX)) as unknown as AnyArgs;
    expect(sut.calls).toEqual(['cancel', 'record:EXECUTED', 'email']);
    expect(sut.cancelBySeller).toHaveBeenCalledWith(
      expect.objectContaining({ actor: { type: 'STORE', id: 'su1' }, sellerId: 's1' }),
    );
    expect(out['status']).toBe(StoreOrderRequestStatus.EXECUTED);
    expect(sut.decided).toHaveBeenCalledWith(
      expect.objectContaining({ approved: true, carriedOut: true }),
    );
  });

  it('a cancel the order has moved past is FAILED with the refusal verbatim, and the store is told', async () => {
    const sut = makeDecision({
      cancelThrows: {
        response: { code: 'NOT_CANCELLABLE', message: 'This order is already packed' },
      },
    });
    const out = (await sut.svc.approve(SELLER, 'req1', null, CTX)) as unknown as AnyArgs;
    expect(out['status']).toBe(StoreOrderRequestStatus.FAILED);
    expect(out['failureReason']).toBe('[NOT_CANCELLABLE] This order is already packed');
    expect(sut.decided).toHaveBeenCalledWith(
      expect.objectContaining({ carriedOut: false, outcome: expect.stringContaining('packed') }),
    );
  });

  it('a lost race is STORE_REQUEST_ALREADY_DECIDED and runs nothing', async () => {
    const sut = makeDecision({ claimed: 0 });
    await expect(sut.svc.approve(SELLER, 'req1', null, CTX)).rejects.toMatchObject({
      response: { code: 'STORE_REQUEST_ALREADY_DECIDED' },
    });
    expect(sut.cancelBySeller).not.toHaveBeenCalled();
    expect(sut.decided).not.toHaveBeenCalled();
  });

  it('a call-cap answer whose review is already answered runs nothing and is FAILED', async () => {
    const sut = makeDecision({
      kind: StoreOrderRequestKind.CALL_CAP_DECISION,
      reviewStatus: EarlyReservationReviewStatus.SELLER_RELEASED,
    });
    const out = (await sut.svc.approve(SELLER, 'req1', null, CTX)) as unknown as AnyArgs;
    expect(sut.decideAsStore).not.toHaveBeenCalled();
    expect(out['status']).toBe(StoreOrderRequestStatus.FAILED);
  });

  it('an approved call-cap answer runs decideAsStore as the store', async () => {
    const sut = makeDecision({ kind: StoreOrderRequestKind.CALL_CAP_DECISION });
    await sut.svc.approve(SELLER, 'req1', null, CTX);
    expect(sut.decideAsStore).toHaveBeenCalledWith(
      'st1',
      's1',
      'rev1',
      'REQUEST_MORE_ATTEMPTS',
      'su1',
      'why',
      expect.anything(),
    );
  });

  it('an approved issue opens the store’s ticket with Skydrop and keeps its id', async () => {
    const sut = makeDecision({ kind: StoreOrderRequestKind.RAISE_ISSUE });
    const out = (await sut.svc.approve(SELLER, 'req1', null, CTX)) as unknown as AnyArgs;
    expect(sut.openStoreIssue).toHaveBeenCalledWith({
      storeId: 'st1',
      storeUserId: 'su1',
      orderId: 'o1',
      subject: 'Crushed',
      description: 'why',
    });
    expect(out['executionRef']).toBe('tkt1');
  });

  it('rejecting runs nothing, reaches Skydrop with nothing, and tells the store', async () => {
    const sut = makeDecision({ kind: StoreOrderRequestKind.RAISE_ISSUE });
    await sut.svc.reject(SELLER, 'req1', 'We will handle this ourselves');
    expect(sut.openStoreIssue).not.toHaveBeenCalled();
    expect(sut.decided).toHaveBeenCalledWith(expect.objectContaining({ approved: false }));
  });
});

describe('StoreRequestExpiryService — remind once, expire once, an answer wins', () => {
  const NOW = new Date('2026-09-20T12:00:00Z');
  const hoursAgo = (h: number): Date => new Date(NOW.getTime() - h * 3_600_000);

  function make(opts: { claimCount?: number; rows: AnyArgs[]; kind: 'order' | 'action' }) {
    const updateMany = jest.fn(async (_args: { where: AnyArgs; data: AnyArgs }) => ({
      count: opts.claimCount ?? 1,
    }));
    const facts = {
      orderNumber: 'SD-1',
      storeNameSnapshot: 'Store',
      seller: { companyName: 'Acme' },
    };
    const pick = (where: AnyArgs): AnyArgs[] =>
      opts.rows
        .filter((r) => {
          const created = where['createdAt'] as { lt: Date; gte?: Date };
          const t = (r['createdAt'] as Date).getTime();
          if (t >= created.lt.getTime()) return false;
          if (created.gte !== undefined && t < created.gte.getTime()) return false;
          if ('sellerRemindedAt' in where && r['sellerRemindedAt'] !== null) return false;
          return true;
        })
        .map((r) => ({ ...r, order: facts }));
    const empty = { findMany: jest.fn(async () => []), updateMany: jest.fn() };
    const live = {
      findMany: jest.fn(async (args: { where: AnyArgs }) => pick(args.where)),
      updateMany,
    };
    const client = {
      systemSetting: {
        findMany: async () => [
          { key: 'reseller.store_request_remind_hours', valueInt: 24 },
          { key: 'reseller.store_request_expire_hours', valueInt: 72 },
        ],
      },
      storeOrderRequest: opts.kind === 'order' ? live : empty,
      orderDeliveryActionRequest: opts.kind === 'action' ? live : empty,
      storeAddressChangeRequest: empty,
    };
    const notifier = {
      remindSeller: jest.fn(async () => undefined),
      expired: jest.fn(async () => undefined),
    };
    const svc = new StoreRequestExpiryService(
      { client } as never,
      { log: jest.fn(async () => 'a1') } as never,
      notifier as never,
    );
    return { svc, updateMany, notifier };
  }

  const base = {
    id: 'r1',
    orderId: 'o1',
    sellerId: 's1',
    storeId: 'st1',
    kind: StoreOrderRequestKind.CANCEL,
    callCapProposal: null,
    issueSubject: null,
    sellerRemindedAt: null,
  };

  it('a request 30h old is reminded once, by a guarded claim, and not expired', async () => {
    const sut = make({ kind: 'order', rows: [{ ...base, createdAt: hoursAgo(30) }] });
    const out = await sut.svc.sweep(NOW);
    expect(out).toEqual({ reminded: 1, expired: 0, failures: 0 });
    expect(sut.updateMany).toHaveBeenCalledWith({
      where: { id: 'r1', status: StoreOrderRequestStatus.PENDING, sellerRemindedAt: null },
      data: { sellerRemindedAt: expect.any(Date) },
    });
    expect(sut.notifier.remindSeller).toHaveBeenCalledTimes(1);
  });

  it('an already-reminded request is not reminded again', async () => {
    const sut = make({
      kind: 'order',
      rows: [{ ...base, createdAt: hoursAgo(30), sellerRemindedAt: hoursAgo(5) }],
    });
    const out = await sut.svc.sweep(NOW);
    expect(out.reminded).toBe(0);
    expect(sut.notifier.remindSeller).not.toHaveBeenCalled();
  });

  it('a request 80h old is EXPIRED by a guarded claim on PENDING and the store is emailed', async () => {
    const sut = make({ kind: 'order', rows: [{ ...base, createdAt: hoursAgo(80) }] });
    const out = await sut.svc.sweep(NOW);
    expect(out.expired).toBe(1);
    expect(sut.updateMany).toHaveBeenCalledWith({
      where: { id: 'r1', status: StoreOrderRequestStatus.PENDING },
      data: { status: StoreOrderRequestStatus.EXPIRED, expiredAt: expect.any(Date) },
    });
    expect(sut.notifier.expired).toHaveBeenCalledWith(
      expect.objectContaining({ storeId: 'st1', expireHours: 72 }),
    );
    expect(sut.notifier.remindSeller).not.toHaveBeenCalled();
  });

  it('an approval that lands first wins: the claim finds nothing, and nobody is emailed', async () => {
    const sut = make({
      kind: 'order',
      claimCount: 0,
      rows: [{ ...base, createdAt: hoursAgo(80) }],
    });
    const out = await sut.svc.sweep(NOW);
    expect(out.expired).toBe(0);
    expect(sut.notifier.expired).not.toHaveBeenCalled();
  });

  it('covers a held delivery ask too', async () => {
    const sut = make({
      kind: 'action',
      rows: [{ ...base, action: 'RTO', resellerStoreId: 'st1', createdAt: hoursAgo(80) }],
    });
    const out = await sut.svc.sweep(NOW);
    expect(out.expired).toBe(1);
    expect(sut.notifier.expired).toHaveBeenCalledWith(
      expect.objectContaining({ label: 'send the parcel back' }),
    );
  });
});
