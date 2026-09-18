import { ResellerStoreActionMode } from '@skydrop/db';
import { StoreOrderEditService } from '../../src/modules/reseller-order/services/store-order-edit.service';
import type { OrderService } from '../../src/modules/order/services/order.service';
import type { StoreOrdersService } from '../../src/modules/reseller-order/services/store-orders.service';
import type { ResellerStoreActionPolicyService } from '../../src/modules/reseller-store/services/reseller-store-action-policy.service';
import type { StoreAddressChangeService } from '../../src/modules/reseller-order/services/store-address-change.service';
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

/** The same correction, with the account of it seller staff read. */
const WITH_REASON = {
  ...INPUT,
  patch: {
    recipientAddressLine1: '12 MG Road',
    reason: 'Customer rang: the house number is wrong',
  },
};

function make(mode: ResellerStoreActionMode) {
  const orders = { edit: jest.fn().mockResolvedValue({ id: 'order-1' }) };
  const storeOrders = { detail: jest.fn().mockResolvedValue({ id: 'order-1' }) };
  const policies = {
    forStore: jest.fn().mockResolvedValue({ storeId: 'store-1', orderChange: mode }),
  };
  const holds = {
    hold: jest.fn().mockResolvedValue({ id: 'req-1', status: 'PENDING' }),
    listForOrder: jest.fn().mockResolvedValue([]),
  };
  return {
    orders,
    storeOrders,
    policies,
    holds,
    svc: new StoreOrderEditService(
      orders as unknown as OrderService,
      storeOrders as unknown as StoreOrdersService,
      policies as unknown as ResellerStoreActionPolicyService,
      holds as unknown as StoreAddressChangeService,
    ),
  };
}

describe('a store changing its own order (2026-09-16, widened 2026-09-18)', () => {
  it('DIRECT edits through the SELLER’s edit path, scoped to the store', async () => {
    // Reusing `OrderService.edit` is the point: the store inherits the
    // stage gate, the courier route, address revalidation, the money
    // recalculation and the notice to the seller — rather than a second
    // implementation that would drift from all of them.
    const { svc, orders, storeOrders, holds } = make(ResellerStoreActionMode.DIRECT);
    const out = await svc.editRecipient(INPUT);
    const call = orders.edit.mock.calls[0]!;
    expect(call[0]).toBe('seller-1');
    expect(call[1]).toBe('order-1');
    expect(call[3]).toEqual({ type: 'STORE', id: 'su-1' });
    expect(call[5]).toEqual({ storeId: 'store-1' });
    // Read back through the store's own projection.
    expect(storeOrders.detail).toHaveBeenCalledWith('store-1', 'order-1');
    expect(out.applied).toBe(true);
    expect(holds.hold).not.toHaveBeenCalled();
  });

  it('never lets `reason` reach the order — `edit` refuses unknown keys BY NAME', async () => {
    // `reason` belongs to the REQUEST, not the order: `edit` does not
    // know the key and `forbidNonWhitelisted` would reject the whole
    // call, so it has to come off before the patch gets there.
    const { svc, orders } = make(ResellerStoreActionMode.DIRECT);
    await svc.editRecipient(WITH_REASON);
    expect(orders.edit.mock.calls[0]![2]).toEqual({ recipientAddressLine1: '12 MG Road' });
  });

  it('OFF refuses by name and touches no order', async () => {
    const { svc, orders, holds } = make(ResellerStoreActionMode.OFF);
    await expect(svc.editRecipient(INPUT)).rejects.toMatchObject({
      response: { code: 'STORE_ACTION_NOT_ALLOWED' },
    });
    expect(orders.edit).not.toHaveBeenCalled();
    expect(holds.hold).not.toHaveBeenCalled();
  });

  it('ASK_SELLER with no reason is refused — seller staff must be told why', async () => {
    // They cannot tell a corrected typo from a customer who has moved
    // house, and a correction they cannot judge is one they cannot
    // answer.
    const { svc, orders, holds } = make(ResellerStoreActionMode.ASK_SELLER);
    await expect(svc.editRecipient(INPUT)).rejects.toMatchObject({
      response: { code: 'ADDRESS_CHANGE_REASON_REQUIRED' },
    });
    expect(orders.edit).not.toHaveBeenCalled();
    expect(holds.hold).not.toHaveBeenCalled();
  });

  it('ASK_SELLER HOLDS the correction and leaves the order alone', async () => {
    // This is the whole point of the mode, and the assertion that would
    // fail on an implementation that wrote the row AND edited the order:
    // the parcel keeps the address the courier was given until seller
    // staff answer.
    const { svc, orders, holds } = make(ResellerStoreActionMode.ASK_SELLER);
    const out = await svc.editRecipient(WITH_REASON);
    expect(out.applied).toBe(false);
    expect(out.request).toMatchObject({ id: 'req-1' });
    expect(holds.hold).toHaveBeenCalledTimes(1);
    expect(holds.hold.mock.calls[0]![0]).toMatchObject({
      storeId: 'store-1',
      sellerId: 'seller-1',
      orderId: 'order-1',
      fields: { recipientAddressLine1: '12 MG Road' },
      // 2026-09-18: the WHOLE proposed change travels with it, so
      // approving applies exactly what seller staff were shown.
      patch: { recipientAddressLine1: '12 MG Road' },
    });
    expect(orders.edit).not.toHaveBeenCalled();
  });

  it('holds a change that moves the PRODUCTS too, not a recipient-shaped subset', async () => {
    // The widened capability is why the request grew a patch column: a
    // change that also moves quantities cannot be expressed as recipient
    // columns, and a hold that dropped them would apply half of what the
    // store asked for.
    const { svc, holds } = make(ResellerStoreActionMode.ASK_SELLER);
    await svc.editRecipient({
      ...INPUT,
      patch: {
        recipientAddressLine1: '12 MG Road',
        items: [{ variantId: 'v1', quantity: 3, unitPriceInr: 700 }],
        codAmountInr: 2100,
        reason: 'Customer asked for a third one on the phone',
      } as never,
    });
    expect(holds.hold.mock.calls[0]![0]).toMatchObject({
      fields: { recipientAddressLine1: '12 MG Road' },
      patch: {
        recipientAddressLine1: '12 MG Road',
        items: [{ variantId: 'v1', quantity: 3, unitPriceInr: 700 }],
        codAmountInr: 2100,
      },
    });
    // `reason` is the request's, never the order's.
    expect(holds.hold.mock.calls[0]![0].patch).not.toHaveProperty('reason');
  });

  it('the mode travels with the list, so the portal can render honestly', async () => {
    // A capability set to OFF is not shown at all; ASK_SELLER has to say
    // so before somebody types a correction expecting it to take effect.
    const { svc } = make(ResellerStoreActionMode.ASK_SELLER);
    await expect(svc.listAddressChanges('store-1', 'order-1')).resolves.toEqual({
      items: [],
      mode: ResellerStoreActionMode.ASK_SELLER,
    });
  });
});
