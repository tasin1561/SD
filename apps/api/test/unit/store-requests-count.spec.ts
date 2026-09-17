import {
  SellerStoreRequestCountService,
  pendingActionsWhere,
  pendingAddressChangesWhere,
  pendingStoreOrderRequestsWhere,
} from '../../src/modules/reseller-store/services/seller-store-request-count.service';
import { SellerStoreActionDecisionService } from '../../src/modules/delivery-action/services/seller-store-action-decision.service';
import { SellerAddressChangeDecisionService } from '../../src/modules/reseller-order/services/seller-address-change-decision.service';
import { SellerStoreOrderRequestDecisionService } from '../../src/modules/store-order-request-decision/services/seller-store-order-request-decision.service';

/**
 * The nav badge counts BOTH queues, and counts exactly what the screen
 * lists (2026-09-16).
 *
 * The defect this pins: "store actions" shipped two queues that stop at
 * the same seller — a delivery ask and an address correction — and the
 * badge counted only the first. A store asking for a wrong address to be
 * fixed therefore sat PENDING with no signal anywhere, while the parcel
 * kept moving to the address the store had already told us was wrong.
 *
 * The second half matters as much as the first. A badge whose predicate
 * drifts from the list behind it is worse than no badge: staff click a
 * number, find nothing, and stop trusting it. The services live in three
 * different modules and cannot import one another (see the count
 * service's header), so nothing in the DI graph can hold them together —
 * but a TEST can import what a module cannot, which is the same
 * technique the M10 F6 mapping/matrix check uses. Both `listPending`
 * methods are run against one mock here and their `where` compared with
 * the count's, so a filter added to either list fails this suite instead
 * of silently making the badge lie.
 */

const SELLER = 'seller-1';

describe('the count itself', () => {
  function makePrisma(actions: number, addressChanges: number, orderRequests = 0) {
    return {
      client: {
        orderDeliveryActionRequest: { count: jest.fn().mockResolvedValue(actions) },
        storeAddressChangeRequest: { count: jest.fn().mockResolvedValue(addressChanges) },
        storeOrderRequest: { count: jest.fn().mockResolvedValue(orderRequests) },
      },
    };
  }

  it('is EVERY queue added, not just the delivery asks', async () => {
    const prisma = makePrisma(2, 3, 4);
    const svc = new SellerStoreRequestCountService(prisma as never);
    await expect(svc.forSeller(SELLER)).resolves.toEqual({
      total: 9,
      actions: 2,
      addressChanges: 3,
      orderRequests: 4,
    });
  });

  it('counts a held cancel / call-cap answer / issue (2026-09-17)', async () => {
    const prisma = makePrisma(0, 0, 1);
    const svc = new SellerStoreRequestCountService(prisma as never);
    await expect(svc.forSeller(SELLER)).resolves.toMatchObject({ total: 1 });
  });

  it('counts an address correction even when no delivery ask is waiting', async () => {
    // The exact shape of the bug: the badge read zero and the store's
    // customer kept getting a parcel sent to the wrong address.
    const prisma = makePrisma(0, 1);
    const svc = new SellerStoreRequestCountService(prisma as never);
    await expect(svc.forSeller(SELLER)).resolves.toMatchObject({ total: 1 });
  });

  it('asks both tables for THIS seller only', async () => {
    const prisma = makePrisma(0, 0);
    const svc = new SellerStoreRequestCountService(prisma as never);
    await svc.forSeller(SELLER);
    // Scoped by the id the controller took off the token (RBAC-1) — a
    // count is still somebody else's business's numbers.
    expect(prisma.client.orderDeliveryActionRequest.count).toHaveBeenCalledWith({
      where: expect.objectContaining({ sellerId: SELLER }),
    });
    expect(prisma.client.storeAddressChangeRequest.count).toHaveBeenCalledWith({
      where: expect.objectContaining({ sellerId: SELLER }),
    });
    expect(prisma.client.storeOrderRequest.count).toHaveBeenCalledWith({
      where: expect.objectContaining({ sellerId: SELLER }),
    });
  });
});

describe('the badge counts exactly what the screen lists', () => {
  it('the delivery-ask count uses the same filter as the delivery-ask list', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const prisma = { client: { orderDeliveryActionRequest: { findMany } } };
    const list = new SellerStoreActionDecisionService(
      prisma as never,
      {} as never,
      {} as never,
      {} as never,
    );
    await list.listPending(SELLER);

    const listed = findMany.mock.calls[0]?.[0]?.where as Record<string, unknown>;
    expect(listed).toEqual(pendingActionsWhere(SELLER));
  });

  it('the address-correction count uses the same filter as the address-correction list', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const prisma = { client: { storeAddressChangeRequest: { findMany } } };
    const list = new SellerAddressChangeDecisionService(
      prisma as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
    await list.listPending(SELLER);

    const listed = findMany.mock.calls[0]?.[0]?.where as Record<string, unknown>;
    expect(listed).toEqual(pendingAddressChangesWhere(SELLER));
  });

  it('the held-request count uses the same filter as the held-request list', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const prisma = { client: { storeOrderRequest: { findMany } } };
    const list = new SellerStoreOrderRequestDecisionService(
      prisma as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
    await list.listPending(SELLER);

    const listed = findMany.mock.calls[0]?.[0]?.where as Record<string, unknown>;
    expect(listed).toEqual(pendingStoreOrderRequestsWhere(SELLER));
  });
});
