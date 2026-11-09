import { StoreOrderScope, SellerStoreKind } from '@skydrop/db';
import { OrderAddressCheckReadService } from '../../src/modules/address-check/services/order-address-check-read.service';
import type { AddressCheckService } from '../../src/modules/address-check/services/address-check.service';
import type { PrismaService } from '../../src/infrastructure/prisma/prisma.service';

const ORDER = '019fd096-eb5a-70ed-8eca-705d263bb6a6';
const SELLER = '01a0e356-6b93-780c-b198-a2d8b3b9c06c';
const STORE = '01a114cf-5672-706d-8b97-a1ccee1e9300';
const STORE_USER = '01a114d4-2b1f-7a0b-9d21-3f6a7c8e9b11';

const VIEW = { referenceId: 'draft-x', available: true, score: 92 };

/**
 * `found: false` is the tenant reaching for an order the WHERE clause
 * does not match — another seller's, another store's, or a colleague's
 * when an associate is narrowed to their own.
 */
function make(opts: { found: boolean }) {
  const findFirst = jest.fn(async () => (opts.found ? { id: ORDER } : null));
  const prisma = { client: { order: { findFirst } } } as unknown as PrismaService;
  const storedViewForOrder = jest.fn(async () => VIEW);
  const checks = { storedViewForOrder } as unknown as AddressCheckService;
  return {
    svc: new OrderAddressCheckReadService(prisma, checks),
    findFirst,
    storedViewForOrder,
  };
}

const whereOf = (findFirst: jest.Mock): Record<string, unknown> =>
  (findFirst.mock.calls[0]?.[0] as { where: Record<string, unknown> }).where;

describe('OrderAddressCheckReadService — a tenant reads its OWN check only', () => {
  it('scopes a client read on the seller, in the WHERE clause', async () => {
    const { svc, findFirst } = make({ found: true });
    await svc.forSeller(ORDER, SELLER);
    expect(whereOf(findFirst)).toEqual({ id: ORDER, deletedAt: null, sellerId: SELLER });
  });

  it('refuses another seller’s order WITHOUT reading the check at all', async () => {
    // The projection must never run for an order the caller does not
    // own: `address_checks.order_id` is unique, so an unscoped read
    // would hand out any order's verdict for the price of a uuid.
    const { svc, storedViewForOrder } = make({ found: false });
    expect(await svc.forSeller(ORDER, SELLER)).toBeNull();
    expect(storedViewForOrder).not.toHaveBeenCalled();
  });

  it('scopes a member store on the seller, the store and RESELLER kind', async () => {
    const { svc, findFirst } = make({ found: true });
    await svc.forStore(ORDER, {
      sellerId: SELLER,
      storeId: STORE,
      storeUserId: STORE_USER,
      orderScope: StoreOrderScope.ALL,
    });
    expect(whereOf(findFirst)).toEqual({
      id: ORDER,
      deletedAt: null,
      sellerId: SELLER,
      storeId: STORE,
      storeKind: SellerStoreKind.RESELLER,
    });
  });

  it('ASSOC-1: an associate is narrowed to the orders they placed', async () => {
    const { svc, findFirst } = make({ found: true });
    await svc.forStore(ORDER, {
      sellerId: SELLER,
      storeId: STORE,
      storeUserId: STORE_USER,
      orderScope: StoreOrderScope.OWN,
    });
    expect(whereOf(findFirst)).toEqual({
      id: ORDER,
      deletedAt: null,
      sellerId: SELLER,
      storeId: STORE,
      storeKind: SellerStoreKind.RESELLER,
      placedByStoreUserId: STORE_USER,
    });
  });

  it('never widens the query with an undefined owner filter', async () => {
    // `placedByStoreUserId: undefined` reads as "no condition" to Prisma
    // and is invisible at the call site — so ALL scope must omit the key
    // rather than carry it empty.
    const { svc, findFirst } = make({ found: true });
    await svc.forStore(ORDER, {
      sellerId: SELLER,
      storeId: STORE,
      storeUserId: STORE_USER,
      orderScope: StoreOrderScope.ALL,
    });
    expect('placedByStoreUserId' in whereOf(findFirst)).toBe(false);
  });

  it('refuses another store’s order WITHOUT reading the check at all', async () => {
    const { svc, storedViewForOrder } = make({ found: false });
    expect(
      await svc.forStore(ORDER, {
        sellerId: SELLER,
        storeId: STORE,
        storeUserId: STORE_USER,
        orderScope: StoreOrderScope.ALL,
      }),
    ).toBeNull();
    expect(storedViewForOrder).not.toHaveBeenCalled();
  });

  it('hands back the stored projection for an order the caller owns', async () => {
    const { svc } = make({ found: true });
    expect(await svc.forSeller(ORDER, SELLER)).toEqual(VIEW);
  });

  it('an owned order with no check is null, which is the ordinary case', async () => {
    const findFirst = jest.fn(async () => ({ id: ORDER }));
    const prisma = { client: { order: { findFirst } } } as unknown as PrismaService;
    const checks = {
      storedViewForOrder: jest.fn(async () => null),
    } as unknown as AddressCheckService;
    const svc = new OrderAddressCheckReadService(prisma, checks);
    expect(await svc.forSeller(ORDER, SELLER)).toBeNull();
  });
});
