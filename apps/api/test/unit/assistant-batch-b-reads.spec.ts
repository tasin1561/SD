import { NotFoundException } from '@nestjs/common';
import { Prisma } from '@skydrop/db';
import { OrderChargesAssistantReadService } from '../../src/modules/order-charges/services/order-charges-assistant-read.service';
import { SellerWalletAssistantReadService } from '../../src/modules/seller-wallet/services/seller-wallet-assistant-read.service';
import { SellerStockAssistantReadService } from '../../src/modules/inventory-stock/services/seller-stock-assistant-read.service';
import { ConsignmentAssistantReadService } from '../../src/modules/consignment/services/consignment-assistant-read.service';
import { OrderJourneyAssistantReadService } from '../../src/modules/order-journey/services/order-journey-assistant-read.service';
import { TicketAssistantReadService } from '../../src/modules/ticket/services/ticket-assistant-read.service';
import { AddressCheckAssistantReadService } from '../../src/modules/address-check/services/address-check-assistant-read.service';
import {
  OpsMetricsInputError,
  ReportsAssistantReadService,
} from '../../src/modules/admin-reports/services/reports-assistant-read.service';
import { SELLER_A, SELLER_B } from '../helpers/assistant-fixtures';

/**
 * BATCH B — the read services, with a mocked Prisma that hands back the
 * recorded `where` so each scope predicate can be pinned. (A mock has no
 * WHERE engine — the real predicates are proved against Postgres in
 * `assistant-batch-b.e2e-spec.ts`.)
 */
const ORDER = '0191a000-0000-7000-8000-0000000000e1';
const D = (v: string): Prisma.Decimal => new Prisma.Decimal(v);

describe('OrderChargesAssistantReadService', () => {
  function rig(owner: string | null) {
    const orderFind = jest.fn(async (args: { where: { sellerId: string } }) =>
      owner !== null && args.where.sellerId === owner
        ? { id: ORDER, orderNumber: 'SD-1', status: 'DELIVERED', paymentMode: 'COD' }
        : null,
    );
    const chargeFind = jest.fn(async (_args: unknown) => [
      {
        type: 'BASE_SHIPPING',
        description: 'Base shipping',
        status: 'FINAL',
        amountInr: D('162.60'),
        taxRate: null,
        taxAmountInr: null,
        totalAmountInr: D('162.60'),
        computationContext: {
          sellerId: SELLER_A,
          margin: { marginInr: '99.00' },
          rateCardId: 'secret-rate-card',
          flatFee: {
            deliveryFeeInr: '162.60',
            source: 'SELLER_OVERRIDE',
            agreedAmount: '200.00',
            agreedCurrency: 'BDT',
            fxRate: '0.813',
            fxRatePair: 'BDT_INR',
            fxRateSource: 'HISTORY',
            fxRateRecordedAt: '2026-11-01T00:00:00.000Z',
          },
        },
      },
      {
        type: 'GST',
        description: 'GST @ 18%',
        status: 'ESTIMATED',
        amountInr: D('29.27'),
        taxRate: D('18'),
        taxAmountInr: null,
        totalAmountInr: D('29.27'),
        computationContext: null,
      },
    ]);
    const svc = new OrderChargesAssistantReadService({
      client: { order: { findFirst: orderFind }, orderCharge: { findMany: chargeFind } },
    } as never);
    return { svc, orderFind, chargeFind };
  }

  it('reads the order WITH the caller’s seller in the where, and only seller-visible live charges', async () => {
    const { svc, orderFind, chargeFind } = rig(SELLER_A);
    await svc.forSeller(SELLER_A, ORDER);
    expect(orderFind.mock.calls[0]?.[0]).toMatchObject({
      where: { id: ORDER, sellerId: SELLER_A, deletedAt: null },
    });
    expect(chargeFind.mock.calls[0]?.[0]).toMatchObject({
      where: { orderId: ORDER, isVisibleToSeller: true, deletedAt: null },
    });
  });

  it('another seller gets null and the charges are never even read', async () => {
    const { svc, chargeFind } = rig(SELLER_A);
    expect(await svc.forSeller(SELLER_B, ORDER)).toBeNull();
    expect(chargeFind).not.toHaveBeenCalled();
  });

  it('reports the stored lines and the PRC-8 stamp, sums stored totals, and drops everything else', async () => {
    const { svc } = rig(SELLER_A);
    const r = await svc.forSeller(SELLER_A, ORDER);
    expect(r?.totalInr).toBe('191.87');
    expect(r?.lines[0]).toMatchObject({
      label: 'Base shipping',
      state: 'Final',
      totalInr: '162.60',
      agreed: {
        amount: '200.00',
        currency: 'BDT',
        feeSource: 'SELLER_OVERRIDE',
        fxRate: '0.813',
        fxRatePair: 'BDT_INR',
      },
    });
    expect(r?.lines[1]).toMatchObject({ taxRate: '18.00', agreed: null });
    const text = JSON.stringify(r);
    expect(text).not.toMatch(/margin|secret-rate-card|99\.00|rateCard|sellerId/);
  });
});

describe('SellerWalletAssistantReadService', () => {
  it('reads entries with BOTH the caller’s seller and the order in the where, and omits the balance', async () => {
    const findMany = jest.fn(async (_args: unknown) => [
      {
        direction: 'ORDER_CHARGES',
        currency: 'INR',
        amount: D('191.87'),
        reasonCode: null,
        note: null,
        createdAt: new Date('2026-11-05T10:00:00Z'),
      },
    ]);
    const svc = new SellerWalletAssistantReadService({
      client: { sellerWalletEntry: { findMany } },
    } as never);
    const rows = await svc.entriesForOrder(SELLER_A, ORDER);
    expect(findMany.mock.calls[0]?.[0]).toMatchObject({
      where: { sellerId: SELLER_A, linkedOrderId: ORDER },
    });
    expect(JSON.stringify(findMany.mock.calls[0]?.[0])).not.toContain('runningBalanceAfter');
    expect(rows[0]).toMatchObject({ direction: 'ORDER_CHARGES', amount: '191.87' });
    expect(JSON.stringify(rows)).not.toContain('runningBalance');
  });
});

describe('SellerStockAssistantReadService', () => {
  const variant = {
    variantId: 'v1',
    skuCode: 'KURTA-BLUE-M',
    productName: 'Blue kurta',
    variantLabel: 'M',
    status: 'ACTIVE',
    lowStockThreshold: null,
  };
  function rig(opts: { agg?: unknown; throwNotFound?: boolean } = {}) {
    const getVariantBySku = jest.fn(async (sellerId: string, sku: string) =>
      sellerId === SELLER_A && sku === 'KURTA-BLUE-M' ? variant : null,
    );
    const compute = jest.fn(async (_input: unknown) => 4);
    const byVariant = jest.fn(async () => {
      if (opts.throwNotFound) throw new NotFoundException();
      return (
        opts.agg ?? {
          qtyOnHand: 9,
          qtyReserved: 2,
          qtyAvailable: 7,
          qtyInTransit: 5,
          lowStockThreshold: 6,
          warehouseCount: 2,
        }
      );
    });
    const svc = new SellerStockAssistantReadService(
      { getVariantBySku } as never,
      { compute } as never,
      { fulfillingWarehouseIds: async () => ['w1', 'w2'] } as never,
      { byVariant } as never,
    );
    return { svc, getVariantBySku, compute, byVariant };
  }

  it('resolves the SKU through the catalog with the caller’s seller, never reads stock for a foreign SKU', async () => {
    const { svc, compute, byVariant } = rig();
    expect(await svc.forSeller(SELLER_B, 'KURTA-BLUE-M')).toBeNull();
    expect(compute).not.toHaveBeenCalled();
    expect(byVariant).not.toHaveBeenCalled();
  });

  it('available is the INV-3 compute() summed over the fulfilling warehouses', async () => {
    const { svc, compute } = rig();
    const r = await svc.forSeller(SELLER_A, ' KURTA-BLUE-M ');
    expect(compute).toHaveBeenCalledTimes(2);
    expect(compute.mock.calls[0]?.[0]).toMatchObject({ sellerId: SELLER_A, variantId: 'v1' });
    expect(r).toMatchObject({
      qtyAvailable: 8,
      qtyOnHand: 9,
      qtyReserved: 2,
      qtyInTransit: 5,
      lowStockThreshold: 6,
      isLowStock: false,
    });
  });

  it('a real SKU with no stock anywhere is zero, not missing', async () => {
    const { svc } = rig({ throwNotFound: true });
    const r = await svc.forSeller(SELLER_A, 'KURTA-BLUE-M');
    expect(r).toMatchObject({ qtyOnHand: 0, qtyInTransit: 0 });
  });
});

describe('ConsignmentAssistantReadService', () => {
  it('finds the number with the caller’s seller in the where, then reads through the seller route’s own call', async () => {
    const findFirst = jest.fn(async (args: { where: { sellerId: string } }) =>
      args.where.sellerId === SELLER_A ? { id: 'c1' } : null,
    );
    const getForSeller = jest.fn(async () => ({
      consignmentNumber: 'CN-1',
      status: 'IN_TRANSIT',
      route: 'BD_TO_IN',
      sellerReference: null,
      expectedArrivalAt: null,
      cancelledAt: null,
      cancelReason: null,
      freightCharges: [{ totalInr: D('9999') }],
      receipts: [
        {
          receiptNumber: 'GR-1',
          leg: 'BD_INTAKE',
          status: 'COMPLETED',
          dispatchedAt: null,
          receivedAt: null,
          hasDiscrepancies: false,
          warehouse: { name: 'Dhaka', countryCode: 'BD' },
          lines: [
            {
              expectedQty: 10,
              receivedQty: 9,
              damagedQty: 1,
              variant: { skuCode: 'S1', product: { name: 'Kurta' } },
            },
          ],
        },
      ],
    }));
    const svc = new ConsignmentAssistantReadService(
      { client: { consignment: { findFirst } } } as never,
      { getForSeller } as never,
    );
    expect(await svc.forSeller(SELLER_B, 'CN-1')).toBeNull();
    expect(getForSeller).not.toHaveBeenCalled();
    const r = await svc.forSeller(SELLER_A, 'CN-1');
    expect(findFirst.mock.calls[1]?.[0]).toMatchObject({
      where: { sellerId: SELLER_A, deletedAt: null },
    });
    expect(r?.legs[0]).toMatchObject({ leg: 'BD_INTAKE', warehouse: 'Dhaka' });
    expect(JSON.stringify(r)).not.toMatch(/9999|freight|totalInr/);
  });
});

describe('OrderJourneyAssistantReadService', () => {
  const journey = {
    orderNumber: 'SD-1',
    orderStatus: 'DELIVERY_FAILED',
    parcels: [
      {
        awbNumber: 'AWB1',
        courierCode: 'DELHIVERY',
        status: 'DELIVERY_ATTEMPTED',
        courierStatusLine: 'Attempted',
        expectedDeliveryAt: null,
        collectableAmountInr: '999.00',
        courierCollectableInr: '999.00',
      },
    ],
    timeline: [
      {
        at: new Date('2026-11-06T09:00:00Z'),
        nslCode: 'EOD-74',
        location: 'Pune',
        attempt: {
          number: 2,
          reason: 'Customer not available',
          notes: 'call me on 9876543210',
          nextAttemptAt: null,
          agentName: 'Ravi',
          agentPhone: '9876543210',
          contactedCustomer: false,
          customerResponse: 'said he is out',
          nsl: {
            code: 'EOD-74',
            plain: 'Not available',
            reAttemptable: true,
            reschedulable: false,
          },
        },
      },
      { at: new Date('2026-11-05T09:00:00Z'), nslCode: null, location: null, attempt: null },
    ],
  };

  it('keeps customer-safe fields only: no driver name, phone, notes, customer reply or money', async () => {
    const forOrder = jest.fn(async () => journey);
    const svc = new OrderJourneyAssistantReadService({ forOrder } as never);
    const r = await svc.forOrder(ORDER, SELLER_A);
    expect(forOrder).toHaveBeenCalledWith(ORDER, SELLER_A);
    expect(r?.failedAttempts).toEqual([
      expect.objectContaining({
        attemptNumber: 2,
        reason: 'Customer not available',
        canAskForReattempt: true,
        meaning: 'Not available',
      }),
    ]);
    expect(JSON.stringify(r)).not.toMatch(/Ravi|9876543210|call me|said he is out|999\.00/);
  });

  it('a miss from the scoped journey query is null, not an error', async () => {
    const svc = new OrderJourneyAssistantReadService({
      forOrder: async () => {
        throw new NotFoundException();
      },
    } as never);
    expect(await svc.forOrder(ORDER, SELLER_B)).toBeNull();
  });
});

describe('TicketAssistantReadService', () => {
  const ticket = {
    id: 't1',
    ticketNumber: 'TK-2026-000003',
    ticketType: 'LOST_PARCEL',
    status: 'OPEN',
    subject: 'Lost',
    orderNumber: 'SD-1',
    shipmentNumber: null,
    createdAt: new Date('2026-11-02T00:00:00Z'),
    resolvedAt: null,
    resolutionAmountInr: null,
  };
  const events = [
    { actorType: 'SELLER', at: new Date('2026-11-02T00:00:00Z') },
    { actorType: 'STAFF', at: new Date('2026-11-03T00:00:00Z') },
    { actorType: 'SELLER', at: new Date('2026-11-04T00:00:00Z') },
  ];

  it('seller: lists with the caller’s seller, matches the number exactly, reports staff vs any activity', async () => {
    const listForSeller = jest.fn(async (sellerId: string) =>
      sellerId === SELLER_A ? [ticket] : [],
    );
    const evts = jest.fn(async () => events);
    const svc = new TicketAssistantReadService({ listForSeller, events: evts } as never);
    expect(await svc.forSeller(SELLER_B, 'TK-2026-000003')).toBeNull();
    const r = await svc.forSeller(SELLER_A, 'tk-2026-000003');
    expect(listForSeller.mock.calls[1]?.[0]).toBe(SELLER_A);
    expect(evts).toHaveBeenCalledWith('t1', SELLER_A);
    expect(r).toMatchObject({
      lastActivityAt: '2026-11-04T00:00:00.000Z',
      lastStaffReplyAt: '2026-11-03T00:00:00.000Z',
    });
    expect(await svc.forSeller(SELLER_A, 'TK-2026-000004')).toBeNull();
  });

  it('store: passes the store AND the viewer, and copies no settlement figure', async () => {
    const storeView = {
      ...ticket,
      figures: { visible: true, snapshot: { parties: [{ netInr: '777.00' }] } },
      disputeClaimAmountInr: '555.00',
      disputePayer: 'STORE',
      resolutionAmountInr: '444.00',
    };
    const listForStore = jest.fn(async () => ({
      items: [storeView],
      total: 1,
      page: 1,
      pageSize: 100,
    }));
    const eventsForStore = jest.fn(async () => events);
    const svc = new TicketAssistantReadService({ listForStore, eventsForStore } as never);
    const viewer = { storeUserId: 'u1', orderScope: 'OWN' as const };
    const r = await svc.forStore('store-1', viewer, 'TK-2026-000003');
    expect(listForStore).toHaveBeenCalledWith('store-1', expect.anything(), viewer);
    expect(eventsForStore).toHaveBeenCalledWith('store-1', 't1', viewer);
    expect(JSON.stringify(r)).not.toMatch(/777|555|444|figures|payer|resolutionAmount/);
  });
});

describe('AddressCheckAssistantReadService', () => {
  it('explains the verdict and withholds the completed address, extracted fields and sources', async () => {
    const svc = new AddressCheckAssistantReadService({
      storedViewForOrder: async () => ({
        referenceId: 'draft-1',
        available: true,
        status: 'needs_review',
        action: 'confirm_with_customer',
        score: 41,
        poConfidence: 'medium',
        completedAddress: '12 Rose Street, Andheri, Mumbai',
        issues: [{ code: 'NO_LANDMARK', message: 'No landmark' }],
        suggestions: [{ field: 'locality', candidates: ['12 Rose Street'], reason: 'Two match' }],
        extracted: { line1: '12 Rose Street' },
        fieldSource: { line1: 'ola' },
        rtoRisk: null,
        rtoRiskStatus: null,
        rechecked: false,
        questions: [{ field: 'locality', text: 'Which locality?', options: ['Andheri'] }],
        providersUsed: ['ola'],
      }),
    } as never);
    const r = await svc.forOrder(ORDER);
    expect(r).toMatchObject({ score: 41, recommendedAction: 'confirm_with_customer' });
    expect(JSON.stringify(r)).not.toMatch(/Rose Street|Andheri|extracted|ola/);
    expect(
      await new AddressCheckAssistantReadService({
        storedViewForOrder: async () => null,
      } as never).forOrder(ORDER),
    ).toBeNull();
  });
});

describe('ReportsAssistantReadService', () => {
  const summary = jest.fn(async () => ({
    orders: { created: 40, delivered: 25, rtoInitiated: 5, rejectedNdr: 3 },
    wallet: { codCollected: '12000.00' },
  }));
  const svc = (prisma: unknown = {}) =>
    new ReportsAssistantReadService(prisma as never, { summary } as never);
  const base = { from: '2026-11-01', to: '2026-11-10' };

  it('with no grouping it is the Reports page’s own summary, over an inclusive range', async () => {
    const r = await svc().run({ metric: 'orders_delivered', groupBy: 'none', ...base });
    expect(r.total).toBe('25');
    const range = summary.mock.calls[0] as unknown as [{ from: Date; to: Date }];
    expect(range[0].from.toISOString()).toBe('2026-11-01T00:00:00.000Z');
    expect(range[0].to.toISOString()).toBe('2026-11-11T00:00:00.000Z');
    expect((await svc().run({ metric: 'cod_collected', groupBy: 'none', ...base })).total).toBe(
      '12000.00',
    );
  });

  it('groups by client with the same status sets as the page, naming clients, top 20 at most', async () => {
    const groupBy = jest.fn(async () => [
      { sellerId: 's1', _count: { _all: 3 } },
      { sellerId: 's2', _count: { _all: 9 } },
    ]);
    const r = await svc({
      client: {
        order: { groupBy },
        seller: {
          findMany: async () => [
            { id: 's1', companyName: 'Alpha' },
            { id: 's2', companyName: 'Bravo' },
          ],
        },
      },
    }).run({ metric: 'orders_returned', groupBy: 'client', ...base });
    expect(r.total).toBe('12');
    expect(r.rows).toEqual([
      { key: 'Bravo', value: '9' },
      { key: 'Alpha', value: '3' },
    ]);
    const where = (groupBy.mock.calls[0] as unknown as [{ where: { status: { in: string[] } } }])[0]
      .where;
    expect(where.status.in).toEqual(
      expect.arrayContaining(['RTO_INITIATED', 'RTO_IN_TRANSIT', 'RTO_RECEIVED']),
    );
  });

  it('refuses what it cannot answer honestly, and bad input, in plain words', async () => {
    const s = svc({ client: {} });
    await expect(
      s.run({ metric: 'cod_collected', groupBy: 'courier', ...base }),
    ).rejects.toBeInstanceOf(OpsMetricsInputError);
    await expect(
      s.run({ metric: 'orders_failed', groupBy: 'courier', ...base }),
    ).rejects.toBeInstanceOf(OpsMetricsInputError);
    await expect(
      s.run({ metric: 'orders_created', groupBy: 'none', from: '2026-11-10', to: '2026-11-01' }),
    ).rejects.toThrow(/before/);
    await expect(
      s.run({ metric: 'orders_created', groupBy: 'none', from: '2026-01-01', to: '2026-11-01' }),
    ).rejects.toThrow(/92 days/);
    await expect(
      s.run({ metric: 'orders_created', groupBy: 'none', from: '2026-02-30', to: '2026-03-02' }),
    ).rejects.toThrow(/real date/);
  });

  it('groups by day in UTC from the created-at stamps', async () => {
    const r = await svc({
      client: {
        order: {
          findMany: async () => [
            { createdAt: new Date('2026-11-02T23:59:00Z') },
            { createdAt: new Date('2026-11-02T01:00:00Z') },
            { createdAt: new Date('2026-11-03T00:00:00Z') },
          ],
        },
      },
    }).run({ metric: 'orders_created', groupBy: 'day', ...base });
    expect(r.rows).toEqual([
      { key: '2026-11-02', value: '2' },
      { key: '2026-11-03', value: '1' },
    ]);
  });
});
