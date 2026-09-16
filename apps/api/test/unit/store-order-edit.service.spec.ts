import { ResellerStoreActionMode } from '@skydrop/db';
import { StoreOrderEditService } from '../../src/modules/reseller-order/services/store-order-edit.service';
import type { OrderService } from '../../src/modules/order/services/order.service';
import type { StoreOrdersService } from '../../src/modules/reseller-order/services/store-orders.service';
import type { ResellerStoreActionPolicyService } from '../../src/modules/reseller-store/services/reseller-store-action-policy.service';
import type { ClientContext } from '../../src/modules/seller-auth/seller-auth.service';

const CTX: ClientContext = { ipAddress: '1.1.1.1', userAgent: 'test', requestId: null };

const INPUT = {
  storeId: 'store-1',
  storeUserId: 'su-1',
  sellerId: 'seller-1',
  orderId: 'order-1',
  patch: { recipientAddressLine1: '12 MG Road' },
  ctx: CTX,
};

function make(mode: ResellerStoreActionMode) {
  const orders = { edit: jest.fn().mockResolvedValue({ id: 'order-1' }) };
  const storeOrders = { detail: jest.fn().mockResolvedValue({ id: 'order-1' }) };
  const policies = {
    forStore: jest.fn().mockResolvedValue({ storeId: 'store-1', addressFix: mode }),
  };
  return {
    orders,
    storeOrders,
    policies,
    svc: new StoreOrderEditService(
      orders as unknown as OrderService,
      storeOrders as unknown as StoreOrdersService,
      policies as unknown as ResellerStoreActionPolicyService,
    ),
  };
}

describe('a store correcting its own order’s address (2026-09-16)', () => {
  it('DIRECT edits through the SELLER’s edit path, scoped to the store', async () => {
    // Reusing `OrderService.edit` is the point: the store inherits the
    // DRAFT/PENDING gate, address revalidation and EDIT_DURING_CALL
    // rather than a second implementation that would drift from them.
    const { svc, orders, storeOrders } = make(ResellerStoreActionMode.DIRECT);
    await svc.editRecipient(INPUT);
    const call = orders.edit.mock.calls[0]!;
    expect(call[0]).toBe('seller-1');
    expect(call[1]).toBe('order-1');
    expect(call[3]).toEqual({ type: 'STORE', id: 'su-1' });
    expect(call[5]).toEqual({ storeId: 'store-1' });
    // Read back through the store's own projection.
    expect(storeOrders.detail).toHaveBeenCalledWith('store-1', 'order-1');
  });

  it('OFF refuses by name and touches no order', async () => {
    const { svc, orders } = make(ResellerStoreActionMode.OFF);
    await expect(svc.editRecipient(INPUT)).rejects.toMatchObject({
      response: { code: 'STORE_ACTION_NOT_ALLOWED' },
    });
    expect(orders.edit).not.toHaveBeenCalled();
  });

  it('ASK_SELLER refuses rather than silently acting', async () => {
    // The delivery-action queue cannot hold this one — its rows need a
    // shipment and an unconfirmed order has none — so until there is a
    // request row for it, "ask the seller" means the seller does it.
    const { svc, orders } = make(ResellerStoreActionMode.ASK_SELLER);
    await expect(svc.editRecipient(INPUT)).rejects.toMatchObject({
      response: { code: 'STORE_ACTION_NOT_ALLOWED' },
    });
    expect(orders.edit).not.toHaveBeenCalled();
  });
});
