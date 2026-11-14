import type { PrismaService } from '../../src/infrastructure/prisma/prisma.service';
import type { CatalogReadService } from '../../src/modules/catalog-read/services/catalog-read.service';
import type { OrderReadService } from '../../src/modules/order/services/order-read.service';
import type { OrderWriteService } from '../../src/modules/order/services/order-write.service';
import { StoreOrdersService } from '../../src/modules/reseller-order/services/store-orders.service';
import type { ResellerStoreActionPolicyService } from '../../src/modules/reseller-store/services/reseller-store-action-policy.service';
import type { ShipmentProvisionService } from '../../src/modules/shipment-provision/services/shipment-provision.service';
import type { StoreOrderRequestService } from '../../src/modules/store-order-request/services/store-order-request.service';

/**
 * The store order list carries the order's AWB. The AWB is read for the
 * ids of the page the scoped query returned, and for nothing else, so
 * another seller's (or store's) parcel can never show up in this list.
 */
describe('store order list — AWB scope', () => {
  const mine = {
    id: 'order-mine',
    orderNumber: 'ORD-1',
    sellerOrderRef: null,
    status: 'CONFIRMED',
    source: 'MANUAL',
    placedAt: new Date('2026-11-01T00:00:00Z'),
    recipientName: 'A',
    recipientPhoneE164: '+911',
    recipientCity: '',
    recipientPostalCode: '110001',
    paymentMode: 'COD',
    codAmountInr: null,
    _count: { items: 1 },
  };

  it('asks for the AWB of the page ids only, and shows a foreign AWB nowhere', async () => {
    const findMany = jest.fn(async () => [mine]);
    const count = jest.fn(async () => 1);
    const prisma = { client: { order: { findMany, count } } } as unknown as PrismaService;
    // A map that ALSO holds another seller's order, as a careless read would.
    const summariesForOrders = jest.fn(
      async (ids: string[]) =>
        new Map(
          [
            ['order-mine', 'AWB-MINE'],
            ['order-foreign', 'AWB-FOREIGN'],
          ]
            .filter(([id]) => ids.includes(id as string) || id === 'order-foreign')
            .map(([id, awb]) => [id, { awbNumber: awb }]),
        ),
    );
    const svc = new StoreOrdersService(
      prisma,
      {} as unknown as CatalogReadService,
      {} as unknown as OrderReadService,
      {} as unknown as OrderWriteService,
      {} as unknown as ResellerStoreActionPolicyService,
      {} as unknown as StoreOrderRequestService,
      { summariesForOrders } as unknown as ShipmentProvisionService,
    );
    const res = await svc.list('store-1', { kind: 'STORE_API_KEY' } as never, {});
    expect(summariesForOrders).toHaveBeenCalledWith(['order-mine']);
    expect(res.items.map((i) => i.awbNumber)).toEqual(['AWB-MINE']);
    expect(JSON.stringify(res)).not.toContain('AWB-FOREIGN');
  });

  it('an order without a parcel has a null AWB', async () => {
    const prisma = {
      client: { order: { findMany: jest.fn(async () => [mine]), count: jest.fn(async () => 1) } },
    } as unknown as PrismaService;
    const svc = new StoreOrdersService(
      prisma,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      { summariesForOrders: jest.fn(async () => new Map()) } as unknown as ShipmentProvisionService,
    );
    const res = await svc.list('store-1', { kind: 'STORE_API_KEY' } as never, {});
    expect(res.items[0]?.awbNumber).toBeNull();
  });
});
