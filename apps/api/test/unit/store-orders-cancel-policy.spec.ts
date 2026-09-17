import { ResellerStoreActionMode } from '@skydrop/db';
import { StoreOrdersService } from '../../src/modules/reseller-order/services/store-orders.service';
import type { PrismaService } from '../../src/infrastructure/prisma/prisma.service';
import type { CatalogReadService } from '../../src/modules/catalog-read/services/catalog-read.service';
import type { OrderReadService } from '../../src/modules/order/services/order-read.service';
import type { OrderWriteService } from '../../src/modules/order/services/order-write.service';
import type { ResellerStoreActionPolicyService } from '../../src/modules/reseller-store/services/reseller-store-action-policy.service';
import type { StoreOrderRequestService } from '../../src/modules/store-order-request/services/store-order-request.service';
import type { ClientContext } from '../../src/modules/seller-auth/seller-auth.service';

const USER = { id: 'su-1', storeId: 'store-1' };
const CTX = { ipAddress: '1.1.1.1', userAgent: 'test' } as unknown as ClientContext;

function make(mode: ResellerStoreActionMode, order: { id: string; sellerId: string } | null) {
  const findFirst = jest.fn().mockResolvedValue(order);
  const prisma = { client: { order: { findFirst } } } as unknown as PrismaService;
  const orderWrite = { cancelBySeller: jest.fn().mockResolvedValue(undefined) };
  const policies = { forStore: jest.fn().mockResolvedValue({ cancel: mode }) };
  const requests = { hold: jest.fn().mockResolvedValue({ id: 'req-1', status: 'PENDING' }) };
  const svc = new StoreOrdersService(
    prisma,
    {} as unknown as CatalogReadService,
    {} as unknown as OrderReadService,
    orderWrite as unknown as OrderWriteService,
    policies as unknown as ResellerStoreActionPolicyService,
    requests as unknown as StoreOrderRequestService,
  );
  // The post-cancel read is not what this spec is about.
  jest.spyOn(svc, 'detail').mockResolvedValue({ id: 'order-1' } as never);
  return { svc, findFirst, orderWrite, policies, requests };
}

const OWNED = { id: 'order-1', sellerId: 'seller-1' };

/**
 * 2026-09-16 — the seller's policy governs whether a store may call its
 * own orders off.
 *
 * This path predates the policy and gated on the `orders.cancel`
 * permission alone, so a seller could switch cancelling off and watch the
 * store keep cancelling. A switch that silently does nothing is the exact
 * failure the switchboard exists to prevent, and nothing would have told
 * anybody.
 */
describe('a store cancelling its own order', () => {
  it('DIRECT cancels through the ordinary seller path', async () => {
    const { svc, orderWrite } = make(ResellerStoreActionMode.DIRECT, OWNED);
    const out = await svc.cancel(USER, 'order-1', {}, CTX);
    expect(out.applied).toBe(true);
    expect(orderWrite.cancelBySeller).toHaveBeenCalledTimes(1);
    // The STORE did it, not the seller — the timeline must say so.
    expect(orderWrite.cancelBySeller.mock.calls[0]![0]).toMatchObject({
      sellerId: 'seller-1',
      actor: { type: 'STORE', id: 'su-1' },
    });
  });

  it('OFF refuses by name and cancels nothing', async () => {
    const { svc, orderWrite } = make(ResellerStoreActionMode.OFF, OWNED);
    await expect(svc.cancel(USER, 'order-1', {}, CTX)).rejects.toMatchObject({
      response: { code: 'STORE_ACTION_NOT_ALLOWED' },
    });
    expect(orderWrite.cancelBySeller).not.toHaveBeenCalled();
  });

  it('ASK_SELLER holds the cancel for seller staff and cancels nothing yet (owner, 2026-09-17)', async () => {
    const { svc, orderWrite, requests } = make(ResellerStoreActionMode.ASK_SELLER, OWNED);
    const out = await svc.cancel(USER, 'order-1', { note: 'Customer changed their mind' }, CTX);
    expect(out).toMatchObject({ applied: false, order: null, request: { id: 'req-1' } });
    expect(orderWrite.cancelBySeller).not.toHaveBeenCalled();
    expect(requests.hold).toHaveBeenCalledWith(
      expect.objectContaining({
        storeId: 'store-1',
        storeUserId: 'su-1',
        orderId: 'order-1',
        kind: 'CANCEL',
        note: 'Customer changed their mind',
      }),
    );
  });

  it('an order that is not this store’s is a 404, checked BEFORE the policy', async () => {
    // Ownership first: otherwise a store with cancelling switched off
    // would learn nothing, but one with it ON could probe another
    // store's order ids by the shape of the refusal.
    const { svc, policies } = make(ResellerStoreActionMode.DIRECT, null);
    await expect(svc.cancel(USER, 'someone-elses', {}, CTX)).rejects.toMatchObject({
      response: { code: 'ORDER_NOT_FOUND' },
    });
    expect(policies.forStore).not.toHaveBeenCalled();
  });
});
