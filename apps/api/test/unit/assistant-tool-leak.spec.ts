import { OrderAssistantReadService } from '../../src/modules/order/services/order-assistant-read.service';
import {
  SELLER_A,
  SELLER_B,
  fakeRegistry,
  scope,
  staffScope,
  type FakeOrder,
} from '../helpers/assistant-fixtures';

/**
 * THE leak test. Seller A asks about seller B's order number: the answer
 * must be indistinguishable from "no such order", and nothing of B's may
 * appear in it.
 *
 * The fake order service applies the seller id it is HANDED, the way
 * `OrderService.list`'s WHERE clause does — so what this proves is that
 * the tool hands it the CALLER's seller (from scope) and nothing the
 * model said.
 */
const ORDERS: FakeOrder[] = [
  { sellerId: SELLER_A, orderNumber: 'SD-A-0001' },
  { sellerId: SELLER_B, orderNumber: 'SD-B-0002' },
];

describe('assistant leak: a seller cannot read another seller’s order', () => {
  const registry = fakeRegistry(ORDERS);

  it('control: seller A reads their own order', async () => {
    const r = await registry.execute(scope(), 'get_my_order', { identifier: 'SD-A-0001' });
    expect(r.isError).toBe(false);
    expect(r.content).toContain('SD-A-0001');
  });

  it('seller A asking for seller B’s order number gets NOT_FOUND and none of B’s data', async () => {
    const r = await registry.execute(scope(), 'get_my_order', { identifier: 'SD-B-0002' });
    expect(r.isError).toBe(true);
    expect(r.errorCode).toBe('NOT_FOUND');
    expect(r.content).not.toContain('SD-B-0002');
    expect(r.content).not.toContain('Pune');
  });

  it('the answer for B’s real order equals the answer for an order that does not exist', async () => {
    const real = await registry.execute(scope(), 'get_my_order', { identifier: 'SD-B-0002' });
    const ghost = await registry.execute(scope(), 'get_my_order', { identifier: 'SD-Z-9999' });
    expect(real.content).toBe(ghost.content);
    expect(real.errorCode).toBe(ghost.errorCode);
  });

  it('the list tool returns only the caller’s own orders', async () => {
    const r = await registry.execute(scope(), 'list_my_recent_orders', {});
    expect(r.content).toContain('SD-A-0001');
    expect(r.content).not.toContain('SD-B-0002');
  });

  it('a sellerId smuggled in as an argument is refused, not honoured', async () => {
    const r = await registry.execute(scope(), 'get_my_order', {
      identifier: 'SD-B-0002',
      sellerId: SELLER_B,
    });
    expect(r.isError).toBe(true);
    expect(r.errorCode).toBe('INVALID_INPUT');
    expect(r.content).not.toContain('SD-B-0002');
  });

  it('a seller cannot run a staff tool by naming it', async () => {
    const r = await registry.execute(scope(), 'get_order', { identifier: 'SD-B-0002' });
    expect(r.isError).toBe(true);
    expect(r.errorCode).toBe('FORBIDDEN');
    expect(r.content).not.toContain('SD-B-0002');
  });

  it('control: staff can read any order (the tool that sellers cannot reach)', async () => {
    const r = await registry.execute(staffScope(), 'get_order', { identifier: 'SD-B-0002' });
    expect(r.isError).toBe(false);
  });
});

describe('OrderAssistantReadService hands the CALLER’s seller to the order service', () => {
  const row = (orderNumber: string, awb: string | null) => ({
    id: `id-${orderNumber}`,
    orderNumber,
    sellerOrderRef: null,
    status: 'CONFIRMED',
    source: 'MANUAL',
    placedAt: new Date('2026-11-01T00:00:00Z'),
    paymentMode: 'COD',
    codAmountInr: { toString: () => '10' },
    recipientName: 'N',
    recipientCity: 'C',
    recipientStateProvince: 'S',
    recipientPostalCode: '1',
    shipment:
      awb === null
        ? null
        : {
            awbNumber: awb,
            courierDisplayName: 'Delhivery',
            manualCourierName: null,
            courierCode: 'delhivery',
          },
  });

  it('passes scope.sellerId to list() and loadOwned(), and matches exactly', async () => {
    const calls: Array<[string, unknown]> = [];
    const orders = {
      list: async (sellerId: string, q: unknown) => {
        calls.push([sellerId, q]);
        // A partial match ("SD-A-00" contains the search) must NOT be returned.
        return {
          items: [row('SD-A-00011', null), row('SD-A-0001', 'AWB1')],
          total: 2,
          page: 1,
          pageSize: 10,
        };
      },
      loadOwned: async (sellerId: string) => {
        calls.push([sellerId, 'loadOwned']);
        return { items: [{ skuCode: 'S', productName: 'P', quantity: 2 }] };
      },
    };
    const svc = new OrderAssistantReadService(orders as never);
    const hit = await svc.findForSeller(SELLER_A, 'SD-A-0001');
    expect(hit?.orderNumber).toBe('SD-A-0001');
    expect(hit?.shipment?.awbNumber).toBe('AWB1');
    expect(calls.map((c) => c[0])).toEqual([SELLER_A, SELLER_A]);
    // Phone, e-mail and street are not part of the projection.
    expect(JSON.stringify(hit)).not.toMatch(/phone|email|addressLine/i);

    expect(await svc.findForSeller(SELLER_A, 'SD-A-0')).toBeNull();
  });
});
