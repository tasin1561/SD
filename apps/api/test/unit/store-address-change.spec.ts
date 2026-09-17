import { BadRequestException, ConflictException } from '@nestjs/common';
import { StoreAddressChangeStatus } from '@skydrop/db';
import { AdvisoryLock, advisoryKey } from '../../src/common/db/advisory-lock';
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
  const locks: Array<[number, number]> = [];
  const client = {
    locks,
    $executeRaw: jest.fn((_strings: TemplateStringsArray, ns: number, key: number) => {
      locks.push([ns, key]);
      return Promise.resolve(1);
    }),
    $transaction: jest.fn(),
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
  client.$transaction.mockImplementation((fn: (tx: unknown) => Promise<unknown>) => fn(client));
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

  it('checks and inserts under the per-order lock, counting an APPROVED correction as open', async () => {
    // A read before the insert with nothing between is not a guard under
    // READ COMMITTED: two clicks both passed. The re-check and the insert
    // now share a transaction holding STORE_ADDRESS_CHANGE on the order.
    const prisma = makePrisma();
    const svc = new StoreAddressChangeService(prisma as never, audit as never, notifier as never);
    await svc.hold({
      storeId: 'store-1',
      storeUserId: 'store-user-1',
      sellerId: 'seller-1',
      orderId: 'order-1',
      reason: 'Customer rang to say the house number is wrong',
      fields: { recipientAddressLine1: '42 New Street' },
    });
    expect(prisma.client.$transaction).toHaveBeenCalledTimes(1);
    expect(prisma.client.locks).toEqual([
      [AdvisoryLock.STORE_ADDRESS_CHANGE, advisoryKey('order-1')],
    ]);
    const where = prisma.client.storeAddressChangeRequest.findFirst.mock.calls[0]![0].where;
    expect(where.status.in).toEqual([
      StoreAddressChangeStatus.PENDING,
      StoreAddressChangeStatus.APPROVED,
    ]);
    // The lock is taken BEFORE the re-check reads.
    expect(prisma.client.$executeRaw.mock.invocationCallOrder[0]).toBeLessThan(
      prisma.client.storeAddressChangeRequest.findFirst.mock.invocationCallOrder[0]!,
    );
  });

  it('refuses a second correction while one is still open, as a 409', async () => {
    // Two proposals for one address cannot both be right, and approving
    // them in whatever order they were decided applies the older last.
    const prisma = makePrisma({ findFirst: jest.fn().mockResolvedValue({ id: 'open' }) });
    const svc = new StoreAddressChangeService(prisma as never, audit as never, notifier as never);
    const err: unknown = await svc
      .hold({
        storeId: 'store-1',
        storeUserId: 'store-user-1',
        sellerId: 'seller-1',
        orderId: 'order-1',
        reason: 'Customer rang to say the house number is wrong',
        fields: { recipientAddressLine1: '42 New Street' },
      })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ConflictException);
    expect(err).toMatchObject({ response: { code: 'ADDRESS_CHANGE_ALREADY_OPEN' } });
    expect(prisma.client.storeAddressChangeRequest.create).not.toHaveBeenCalled();
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
    // The claim is updateMany call 0; the outcome is call 1, guarded on APPROVED.
    expect(prisma.client.storeAddressChangeRequest.updateMany.mock.calls[1]![0]).toMatchObject({
      where: { id: 'req-1', status: StoreAddressChangeStatus.APPROVED },
      data: {
        status: StoreAddressChangeStatus.FAILED,
        failureReason: '[EDIT_DURING_CALL] An agent is on the phone about this order',
      },
    });
    expect(prisma.client.storeAddressChangeRequest.update).not.toHaveBeenCalled();
    // The store has a customer waiting; silence is the real failure here.
    expect(decided).toHaveBeenCalledWith(
      expect.objectContaining({ approved: true, applied: false }),
    );
  });

  it('an applied correction is written guarded on APPROVED, never a plain update', async () => {
    const edit = jest.fn().mockResolvedValue(undefined);
    const { svc, prisma } = build(edit);
    await svc.approve(seller, 'req-1', null, ctx);
    expect(prisma.client.storeAddressChangeRequest.updateMany.mock.calls[1]![0]).toMatchObject({
      where: { id: 'req-1', status: StoreAddressChangeStatus.APPROVED },
      data: { status: StoreAddressChangeStatus.APPLIED },
    });
    expect(prisma.client.storeAddressChangeRequest.update).not.toHaveBeenCalled();
  });

  it('a store user who no longer exists is recorded as the STORE with no id — never the seller user', async () => {
    const edit = jest.fn().mockResolvedValue(undefined);
    const prisma = makePrisma({
      findUniqueOrThrow: jest
        .fn()
        .mockResolvedValue({ ...pendingRow(), requestedByStoreUserId: null }),
    });
    const { svc } = build(edit, prisma);
    await svc.approve(seller, 'req-1', null, ctx);
    expect(edit.mock.calls[0]![3]).toEqual({ type: 'STORE', id: null });
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
