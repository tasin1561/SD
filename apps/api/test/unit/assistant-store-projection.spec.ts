import { AssistantToolRegistry } from '../../src/modules/assistant/services/assistant-tool-registry.service';
import { fakeDeps, storeScope, STORE_1 } from '../helpers/assistant-fixtures';

/**
 * ASSOC-1's boundary, re-checked at the assistant: the store's cost and
 * earnings never reach an ASSOCIATE (or, here, anyone) through a tool
 * result. The fake order view carries every cost-bearing field with a
 * recognisable value; none of those values may appear in the output.
 */
const SECRETS = ['777.77', '888.88', '555.55', '444.44', '333.33', 'TERMS-V9'];

const view = {
  id: 'o1',
  orderNumber: 'ST-0001',
  sellerOrderRef: null,
  status: 'CONFIRMED',
  placedAt: '2026-11-01T00:00:00.000Z',
  confirmedAt: null,
  cancelledAt: null,
  paymentMode: 'COD',
  codAmountInr: '1200.00',
  advanceAmountInr: '555.55',
  deliveryFeeInr: '444.44',
  discountInr: '333.33',
  notes: 'TERMS-V9',
  termsVersion: 9,
  recipient: {
    name: 'Asha',
    phoneE164: '+919999999999',
    email: 'a@b.c',
    addressLine1: '12 Road',
    city: 'Pune',
    stateProvince: 'MH',
    postalCode: '411001',
  },
  lines: [
    {
      skuCode: 'SKU1',
      productName: 'Shirt',
      quantity: 2,
      retailUnitInr: '600',
      cost: {
        visible: true,
        transferPriceInr: '777.77',
        minRetailInr: '888.88',
        maxRetailInr: '888.88',
      },
    },
  ],
  totals: { retailInr: '1200', cost: { visible: true, transferInr: '777.77' } },
  shipments: [{ awbNumber: 'AWB123', courierCode: 'delhivery', status: 'IN_TRANSIT' }],
};

describe('store/associate order tools project only safe fields', () => {
  const calls: unknown[][] = [];
  const reg = AssistantToolRegistry.fromDeps({
    ...fakeDeps(),
    storeOrders: {
      list: async (...a: unknown[]) => {
        calls.push(a);
        return {
          items: [{ ...view, recipientName: 'Asha', recipientCity: 'Pune', itemCount: 2 }],
          total: 1,
          page: 1,
          pageSize: 5,
        };
      },
      detail: async () => view as never,
    } as never,
  });

  it.each(['STORE', 'ASSOCIATE'] as const)(
    '%s: no cost, fee, discount, phone or street in get_my_store_order',
    async (audience) => {
      const s = storeScope({ audience, orderScope: audience === 'ASSOCIATE' ? 'OWN' : 'ALL' });
      const r = await reg.execute(s, 'get_my_store_order', { identifier: 'AWB123' });
      expect(r.isError).toBe(false);
      for (const secret of SECRETS) expect(r.content).not.toContain(secret);
      expect(r.content).not.toMatch(/9999999999|a@b\.c|12 Road/);
      expect(r.content).toContain('1200.00'); // what the customer owes is visible
      expect(r.content).toContain('AWB123');
    },
  );

  it('the store comes from scope, and an associate’s OWN scope is what the order service is given', async () => {
    calls.length = 0;
    await reg.execute(
      storeScope({ audience: 'ASSOCIATE', orderScope: 'OWN', userId: 'person-1' }),
      'list_my_store_orders',
      {},
    );
    expect(calls[0]?.[0]).toBe(STORE_1);
    expect(calls[0]?.[1]).toEqual({ kind: 'STORE_USER', storeUserId: 'person-1', scope: 'OWN' });
  });

  it('the list projection carries no phone or cost either', async () => {
    const r = await reg.execute(storeScope(), 'list_my_store_orders', {});
    for (const secret of SECRETS) expect(r.content).not.toContain(secret);
    expect(r.content).not.toMatch(/Phone|phone|email/);
  });
});
