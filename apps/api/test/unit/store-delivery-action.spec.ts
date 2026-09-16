import { DeliveryActionKind, DeliveryActionStatus, ResellerStoreActionMode } from '@skydrop/db';
import { StoreDeliveryActionService } from '../../src/modules/delivery-action/services/store-delivery-action.service';
import type { DeliveryActionService } from '../../src/modules/delivery-action/services/delivery-action.service';
import type { StoreActionNotifier } from '../../src/modules/delivery-action/services/store-action-notifier.service';
import type { ResellerStoreActionPolicyService } from '../../src/modules/reseller-store/services/reseller-store-action-policy.service';
import type { PrismaService } from '../../src/infrastructure/prisma/prisma.service';
import type { ClientInfoPayload } from '../../src/common/decorators/client-info.decorator';

const CTX = { ipAddress: '1.1.1.1', userAgent: 'test' } as unknown as ClientInfoPayload;

const ORDER = {
  sellerId: 'seller-1',
  orderNumber: 'SD-2026-26-000009',
  storeNameSnapshot: 'Kolkata Kurtas',
};

function make(
  mode: ResellerStoreActionMode,
  order: typeof ORDER | null = ORDER,
  requestStatus: DeliveryActionStatus = DeliveryActionStatus.PENDING,
) {
  const findFirst = jest.fn().mockResolvedValue(order);
  const prisma = {
    client: {
      order: { findFirst },
      orderDeliveryActionRequest: { findMany: jest.fn().mockResolvedValue([]) },
    },
  } as unknown as PrismaService;

  const actions = {
    request: jest.fn().mockResolvedValue({ id: 'req-1', status: requestStatus }),
    toView: jest.fn((r: unknown) => r),
  };
  const policies = {
    forStore: jest.fn().mockResolvedValue({
      storeId: 'store-1',
      recall: mode,
      addressFix: mode,
      cancel: mode,
      callCapDecision: mode,
      chaseSkydrop: mode,
      reattempt: mode,
      sendBack: mode,
      set: true,
      updatedAt: null,
    }),
  };
  const notifier = { waitingOnSeller: jest.fn().mockResolvedValue(undefined) };

  return {
    findFirst,
    actions,
    policies,
    notifier,
    svc: new StoreDeliveryActionService(
      prisma,
      actions as unknown as DeliveryActionService,
      policies as unknown as ResellerStoreActionPolicyService,
      notifier as unknown as StoreActionNotifier,
    ),
  };
}

const ASK = {
  storeId: 'store-1',
  storeUserId: 'su-1',
  orderId: 'order-1',
  action: DeliveryActionKind.RECALL,
  reason: 'The customer rang us and asked for an evening delivery.',
  ctx: CTX,
};

describe('a reseller store asking for something (2026-09-16)', () => {
  it('OFF refuses by name, and nothing is written', async () => {
    const { svc, actions } = make(ResellerStoreActionMode.OFF);
    await expect(svc.request(ASK)).rejects.toMatchObject({
      response: { code: 'STORE_ACTION_NOT_ALLOWED' },
    });
    expect(actions.request).not.toHaveBeenCalled();
  });

  it('DIRECT goes straight through, and does not pester the seller', async () => {
    const { svc, actions, notifier } = make(
      ResellerStoreActionMode.DIRECT,
      ORDER,
      DeliveryActionStatus.EXECUTED,
    );
    const out = await svc.request(ASK);
    expect(out.awaitingSeller).toBe(false);
    expect(actions.request.mock.calls[0]![0]).toMatchObject({
      sellerId: 'seller-1',
      // Nobody at the seller touched this.
      sellerUserId: null,
      store: { storeId: 'store-1', storeUserId: 'su-1', needsSellerApproval: false },
    });
    expect(notifier.waitingOnSeller).not.toHaveBeenCalled();
  });

  it('ASK_SELLER stops at pending and tells the seller somebody is waiting', async () => {
    const { svc, actions, notifier } = make(ResellerStoreActionMode.ASK_SELLER);
    const out = await svc.request(ASK);
    expect(out.awaitingSeller).toBe(true);
    expect(actions.request.mock.calls[0]![0].store.needsSellerApproval).toBe(true);
    expect(notifier.waitingOnSeller.mock.calls[0]![0]).toMatchObject({
      sellerId: 'seller-1',
      requestId: 'req-1',
      storeName: 'Kolkata Kurtas',
      orderNumber: 'SD-2026-26-000009',
    });
  });

  it('another store’s order is a 404 that says nothing about whether it exists', async () => {
    const { svc, actions } = make(ResellerStoreActionMode.DIRECT, null);
    await expect(svc.request(ASK)).rejects.toMatchObject({
      response: { code: 'ORDER_NOT_FOUND' },
    });
    expect(actions.request).not.toHaveBeenCalled();
  });

  it('the order is scoped to the store on the TOKEN, and to reseller orders', async () => {
    const { svc, findFirst } = make(ResellerStoreActionMode.DIRECT);
    await svc.request(ASK);
    expect(findFirst.mock.calls[0]![0].where).toMatchObject({
      id: 'order-1',
      storeId: 'store-1',
      storeKind: 'RESELLER',
      deletedAt: null,
    });
  });

  it('each action is governed by its OWN policy column', async () => {
    // Send-back asks `sendBack`, not `recall` — a store allowed to ring a
    // customer is not thereby allowed to turn a parcel round.
    const { svc, policies } = make(ResellerStoreActionMode.OFF);
    await expect(svc.request({ ...ASK, action: DeliveryActionKind.RTO })).rejects.toMatchObject({
      response: { message: expect.stringContaining('returns') },
    });
    expect(policies.forStore).toHaveBeenCalledWith('store-1');
  });
});
