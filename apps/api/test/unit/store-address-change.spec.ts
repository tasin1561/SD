import { BadRequestException, ConflictException } from '@nestjs/common';
import { StoreAddressChangeStatus } from '@skydrop/db';
import {
  StoreAddressChangeService,
  fieldsFromPatch,
  summarise,
} from '../../src/modules/reseller-order/services/store-address-change.service';
import { SellerAddressChangeDecisionService } from '../../src/modules/reseller-order/services/seller-address-change-decision.service';

/**
 * A reseller store's HELD address correction (2026-09-16).
 *
 * The ROUTING — which mode does what — is pinned next door in
 * `store-order-edit.service.spec.ts`; asserting it in two places is how
 * the two come to disagree. What is pinned HERE is the request itself
 * and the answer to it, including the two failure shapes that are easy
 * to get wrong and impossible to see from outside:
 *
 *  - approving must apply the WHOLE correction. The claim originally
 *    read a narrow projection, which made the applied patch empty while
 *    every status moved exactly as it should.
 *  - an approval the order has already moved past is recorded FAILED and
 *    the store is STILL told. Throwing there would leave the request
 *    APPROVED forever with nothing having happened and nobody told.
 */

const ORDER = {
  orderNumber: 'SD-2026-26-000123',
  storeNameSnapshot: 'Menev Store',
};

function pendingRow() {
  return {
    id: 'req-1',
    orderId: 'order-1',
    sellerId: 'seller-1',
    storeId: 'store-1',
    requestedByStoreUserId: 'store-user-1',
    reason: 'Customer rang to say the house number is wrong',
    recipientAddressLine1: '42 New Street',
    recipientPostalCode: '560001',
    status: StoreAddressChangeStatus.PENDING,
    decidedBySellerUserId: null,
    sellerDecidedAt: null,
    decisionNote: null,
    appliedAt: null,
    failureReason: null,
    createdAt: new Date('2026-09-16T10:00:00Z'),
    updatedAt: new Date('2026-09-16T10:00:00Z'),
  };
}

function makePrisma(requestOverrides: Record<string, unknown> = {}) {
  const client = {
    order: {
      findFirst: jest.fn().mockResolvedValue(ORDER),
      findUnique: jest.fn().mockResolvedValue({
        orderNumber: ORDER.orderNumber,
        seller: { companyName: 'Acme Exports' },
      }),
    },
    storeAddressChangeRequest: {
      findFirst: jest.fn().mockResolvedValue(null),
      findMany: jest.fn().mockResolvedValue([]),
      create: jest
        .fn()
        .mockImplementation(({ data }: { data: Record<string, unknown> }) =>
          Promise.resolve({ ...pendingRow(), ...data }),
        ),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      update: jest
        .fn()
        .mockImplementation(({ data }: { data: Record<string, unknown> }) =>
          Promise.resolve({ ...pendingRow(), ...data }),
        ),
      findUniqueOrThrow: jest.fn().mockResolvedValue(pendingRow()),
      ...requestOverrides,
    },
  };
  return { client };
}

const audit = { log: jest.fn() };
const notifier = { waitingOnSeller: jest.fn(), decided: jest.fn() };

describe('the proposed fields, and how they read to a person', () => {
  it('takes only the recipient fields that were actually sent', () => {
    const fields = fieldsFromPatch({
      recipientAddressLine1: '42 New Street',
      recipientCity: 'Bengaluru',
    } as never);
    expect(fields).toEqual({ recipientAddressLine1: '42 New Street', recipientCity: 'Bengaluru' });
  });

  it('names what is changing, so seller staff are not shown a list of columns', () => {
    expect(summarise({ recipientAddressLine1: 'x' })).toBe('the address');
    expect(summarise({ recipientAddressLine1: 'x', recipientPostalCode: 'y' })).toBe(
      'the address and the PIN code',
    );
    expect(summarise({})).toBe('nothing');
  });
});

describe('StoreAddressChangeService — holding a correction', () => {
  beforeEach(() => jest.clearAllMocks());

  it('writes the row and tells the seller somebody is waiting on them', async () => {
    const prisma = makePrisma();
    const svc = new StoreAddressChangeService(prisma as never, audit as never, notifier as never);
    const view = await svc.hold({
      storeId: 'store-1',
      storeUserId: 'store-user-1',
      sellerId: 'seller-1',
      orderId: 'order-1',
      reason: 'Customer rang to say the house number is wrong',
      fields: { recipientAddressLine1: '42 New Street' },
    });
    expect(view.status).toBe(StoreAddressChangeStatus.PENDING);
    expect(notifier.waitingOnSeller).toHaveBeenCalledTimes(1);
  });

  it('refuses a second correction while one is still waiting', async () => {
    // Two proposals for one address cannot both be right, and approving
    // them in whatever order they were decided applies the older last.
    const prisma = makePrisma({ findFirst: jest.fn().mockResolvedValue({ id: 'open' }) });
    const svc = new StoreAddressChangeService(prisma as never, audit as never, notifier as never);
    await expect(
      svc.hold({
        storeId: 'store-1',
        storeUserId: 'store-user-1',
        sellerId: 'seller-1',
        orderId: 'order-1',
        reason: 'Customer rang to say the house number is wrong',
        fields: { recipientAddressLine1: '42 New Street' },
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('refuses a correction that proposes nothing', async () => {
    const svc = new StoreAddressChangeService(
      makePrisma() as never,
      audit as never,
      notifier as never,
    );
    await expect(
      svc.hold({
        storeId: 'store-1',
        storeUserId: 'store-user-1',
        sellerId: 'seller-1',
        orderId: 'order-1',
        reason: 'Customer rang to say the house number is wrong',
        fields: {},
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('SellerAddressChangeDecisionService — the answer', () => {
  beforeEach(() => jest.clearAllMocks());

  function build(editImpl: jest.Mock, prisma = makePrisma()) {
    const decided = jest.fn();
    const requests = new StoreAddressChangeService(
      prisma as never,
      audit as never,
      notifier as never,
    );
    const svc = new SellerAddressChangeDecisionService(
      prisma as never,
      audit as never,
      { edit: editImpl } as never,
      requests,
      { decided, waitingOnSeller: jest.fn() } as never,
    );
    return { svc, prisma, decided };
  }

  const seller = { id: 'seller-1', userId: 'seller-user-1' } as never;
  const ctx = { ipAddress: null, userAgent: null, requestId: null };

  it('approving applies the WHOLE correction, not an empty patch', async () => {
    const edit = jest.fn().mockResolvedValue(undefined);
    const { svc } = build(edit);
    await svc.approve(seller, 'req-1', null, ctx);
    expect(edit).toHaveBeenCalledTimes(1);
    expect(edit.mock.calls[0]![2]).toEqual({
      recipientAddressLine1: '42 New Street',
      recipientPostalCode: '560001',
    });
    // The store scope is what makes this the store's own order, and the
    // actor is the store: the timeline says who ASKED, not only who
    // allowed it.
    expect(edit.mock.calls[0]![5]).toEqual({ storeId: 'store-1' });
    expect(edit.mock.calls[0]![3]).toEqual({ type: 'STORE', id: 'store-user-1' });
  });

  it('a yes the order has moved past is recorded FAILED, verbatim, and still told', async () => {
    const edit = jest.fn().mockRejectedValue({
      response: { code: 'EDIT_DURING_CALL', message: 'An agent is on the phone about this order' },
    });
    const { svc, prisma, decided } = build(edit);
    await expect(svc.approve(seller, 'req-1', null, ctx)).resolves.toBeDefined();
    expect(prisma.client.storeAddressChangeRequest.update.mock.calls[0]![0].data).toMatchObject({
      status: StoreAddressChangeStatus.FAILED,
      failureReason: '[EDIT_DURING_CALL] An agent is on the phone about this order',
    });
    // The store has a customer waiting; silence is the real failure here.
    expect(decided).toHaveBeenCalledWith(
      expect.objectContaining({ approved: true, applied: false }),
    );
  });

  it('a request somebody else already decided is a conflict, not a second edit', async () => {
    const edit = jest.fn();
    const prisma = makePrisma({ updateMany: jest.fn().mockResolvedValue({ count: 0 }) });
    const { svc } = build(edit, prisma);
    await expect(svc.approve(seller, 'req-1', null, ctx)).rejects.toBeInstanceOf(ConflictException);
    expect(edit).not.toHaveBeenCalled();
  });

  it('rejecting tells the store and never edits the order', async () => {
    const edit = jest.fn();
    const { svc, decided } = build(edit);
    await svc.reject(seller, 'req-1', 'The customer confirmed the original address');
    expect(edit).not.toHaveBeenCalled();
    expect(decided).toHaveBeenCalledWith(expect.objectContaining({ approved: false }));
  });
});
