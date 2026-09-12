import { ChargeType, OrderStatus, Prisma } from '@skydrop/db';
import {
  DELIVERY_REVENUE_TYPES,
  orderFate,
  PNL_LINE_KEYS,
  PnlService,
  RETURN_REVENUE_TYPES,
} from '../../src/modules/treasury/services/pnl.service';
import { OrderStateMachineService } from '../../src/modules/order/services/order-state-machine.service';
import type { PrismaService } from '../../src/infrastructure/prisma/prisma.service';
import type { AuditLogService } from '../../src/modules/auth-common/services/audit-log.service';
import { ShipmentCostService } from '../../src/modules/treasury/services/shipment-cost.service';
import { FakeDb, type Row, type Tables } from './pnl-fake-db';

/*
  The P&L is run here against an in-memory database that EVALUATES its
  filters (./pnl-fake-db). A fake that answered every query the same way
  cannot tell a window that tiles from one that leaks, or a drill-down
  whose rows add up from one that does not — which are exactly the
  defects this report has had.
*/

const D = (v: string): Prisma.Decimal => new Prisma.Decimal(v);
const T = (iso: string): Date => new Date(iso);

/** August, HALF-OPEN: [1 Aug, 1 Sep). */
const FROM = T('2026-08-01T00:00:00.000Z');
const TO = T('2026-09-01T00:00:00.000Z');
const IN = T('2026-08-10T06:00:00.000Z');
/** 1 Oct 2026, 00:00 IST. */
const CUTOVER = T('2026-09-30T18:30:00.000Z');

let seq = 0;
/** Ids sort in creation order, as uuidv7 ids do. */
const nextId = (p: string): string => `${p}-${String(++seq).padStart(5, '0')}`;

type Report = Awaited<ReturnType<PnlService['report']>>;
const line = (r: Report, key: string): Report['lines'][number] | undefined =>
  r.lines.find((l) => l.key === key);
const total = (xs: ReadonlyArray<string | null>): string =>
  xs.reduce((t, x) => (x === null ? t : t.add(D(x))), D('0')).toFixed(2);

interface ShipmentSpec {
  awb?: string | null;
  reverseAwb?: string | null;
  courierCode?: string;
  courierOrderId?: string | null;
  fwd?: string | null;
  rto?: string | null;
  deleted?: boolean;
  superseded?: boolean;
  rtoReceivedAt?: Date | null;
  /** When it was booked; defaults to 1 Jul 2026, before every window here. */
  createdAt?: Date;
}

class World {
  readonly t: Tables = {
    platformBankAccount: [
      { id: 'acct-inr', label: 'HDFC current' },
      { id: 'acct-bdt', label: 'City Bank taka' },
    ],
    courier: [
      { id: 'c-dlv', code: 'delhivery' },
      { id: 'c-sr', code: 'shiprocket' },
    ],
    courierAccount: [
      { id: 'ca-dlv', courierId: 'c-dlv' },
      { id: 'ca-sr', courierId: 'c-sr' },
    ],
    seller: [{ id: 's-1', companyName: 'Menev Store' }],
    expenseCategory: [
      { id: 'cat-fwd', code: 'freight_forwarder' },
      { id: 'cat-rent', code: 'rent' },
    ],
  };

  add(model: string, row: Row): Row {
    (this.t[model] ??= []).push(row);
    return row;
  }

  svc(): PnlService {
    return new PnlService({ client: new FakeDb(this.t).client() } as unknown as PrismaService);
  }

  cutover(at: Date): this {
    this.add('systemSetting', { key: 'pnl.courier_adjustments_from', valueDate: at });
    return this;
  }

  /**
   * An order, its lifecycle events, charges, refunds and parcels.
   *
   * Its charge lines are BILLED by default, as the accrual bills them: one
   * ORDER_CHARGES debit for the delivery-leg lines, one RTO_FEE debit per
   * return-fee line. `debits` replaces the ORDER_CHARGES debit; `billed:
   * false` bills nothing (a quote nobody paid).
   */
  order(spec: {
    events?: Array<[string, Date]>;
    status?: string;
    charges?: Array<[string, string]>;
    /** ORDER_CHARGES wallet debits actually taken. */
    debits?: string[];
    billed?: boolean;
    refunds?: string[];
    shipments?: ShipmentSpec[];
    number?: string;
  }): string {
    const id = nextId('ord');
    const events = spec.events ?? [];
    this.add('order', {
      id,
      orderNumber: spec.number ?? `SD-${id}`,
      status: spec.status ?? events[events.length - 1]?.[0] ?? 'CONFIRMED',
    });
    for (const [toStatus, createdAt] of events) {
      this.add('orderEvent', { id: nextId('ev'), orderId: id, toStatus, createdAt });
    }
    for (const [type, amount] of spec.charges ?? []) {
      this.add('orderCharge', {
        id: nextId('chg'),
        orderId: id,
        type,
        amountInr: D(amount),
        deletedAt: null,
      });
    }
    const charges = spec.charges ?? [];
    const auto = spec.billed !== false;
    const deliveryLines = charges.filter(([t]) =>
      (DELIVERY_REVENUE_TYPES as readonly string[]).includes(t),
    );
    const orderDebits =
      spec.debits ??
      (auto && deliveryLines.length > 0 ? [total(deliveryLines.map(([, a]) => a))] : []);
    for (const amount of orderDebits) {
      this.wallet('ORDER_CHARGES', amount, IN, { linkedOrderId: id });
    }
    for (const [type, amount] of auto ? charges : []) {
      if (type === 'RTO_FEE') this.wallet('RTO_FEE', amount, IN, { linkedOrderId: id });
    }
    for (const amount of spec.refunds ?? []) {
      this.wallet('ORDER_CHARGES_REFUND', amount, IN, { linkedOrderId: id });
    }
    for (const s of spec.shipments ?? []) {
      const sid = nextId('shp');
      this.add('shipment', {
        id: sid,
        shipmentNumber: `SH-${sid}`,
        courierCode: s.courierCode ?? 'delhivery',
        awbNumber: s.awb === undefined ? `AWB-${sid}` : s.awb,
        reverseAwbNumber: s.reverseAwb ?? null,
        courierOrderId: s.courierOrderId ?? null,
        deletedAt: s.deleted === true ? IN : null,
        supersededAt: s.superseded === true ? IN : null,
        rtoReceivedAt: s.rtoReceivedAt ?? null,
        createdAt: s.createdAt ?? T('2026-07-01T00:00:00.000Z'),
        actualCourierCostInr: s.fwd == null ? null : D(s.fwd),
        actualRtoCostInr: s.rto == null ? null : D(s.rto),
      });
      this.add('orderShipment', { id: nextId('os'), orderId: id, shipmentId: sid });
    }
    return id;
  }

  /** A shipment on no order of interest — a voided or foreign one. */
  shipment(s: ShipmentSpec): void {
    this.order({ shipments: [s] });
  }

  wallet(direction: string, amount: string, at: Date, extra: Row = {}): Row {
    return this.add('sellerWalletEntry', {
      id: nextId('we'),
      direction,
      currency: 'INR',
      amount: D(amount),
      createdAt: at,
      sellerId: 's-1',
      linkedOrderId: null,
      linkedEntryId: null,
      ...extra,
    });
  }

  bank(spec: {
    type: string;
    amount: string;
    at: Date;
    currency?: string;
    accountId?: string;
    ownerKind?: string;
    transferId?: string | null;
    settlementId?: string | null;
    inboundFreightChargeId?: string | null;
    expenseCategoryId?: string | null;
    reference?: string | null;
    /** When it was written (`created_at`); defaults to `at`. */
    recordedAt?: Date;
    remittanceId?: string | null;
    isOpeningBalance?: boolean;
  }): Row {
    return this.add('bankEntry', {
      id: nextId('be'),
      accountId: spec.accountId ?? (spec.currency === 'BDT' ? 'acct-bdt' : 'acct-inr'),
      type: spec.type,
      signedAmount: D(spec.amount),
      currency: spec.currency ?? 'INR',
      ownerKind: spec.ownerKind ?? 'CAPITAL',
      occurredAt: spec.at,
      createdAt: spec.recordedAt ?? spec.at,
      remittanceId: spec.remittanceId ?? null,
      isOpeningBalance: spec.isOpeningBalance ?? false,
      transferId: spec.transferId ?? null,
      settlementId: spec.settlementId ?? null,
      inboundFreightChargeId: spec.inboundFreightChargeId ?? null,
      expenseCategoryId: spec.expenseCategoryId ?? null,
      reference: spec.reference ?? null,
    });
  }

  transfer(out: string, outCcy: string, inn: string, inCcy: string): string {
    const id = nextId('tr');
    this.add('bankTransfer', {
      id,
      amountOut: D(out),
      currencyOut: outCcy,
      amountIn: D(inn),
      currencyIn: inCcy,
    });
    return id;
  }

  txn(spec: {
    kind: 'DEBIT' | 'CREDIT';
    amount: string;
    at: Date;
    category?: 'PARCEL' | 'ADJUSTMENT';
    awb?: string | null;
    ref?: string | null;
    account?: string;
    status?: string;
    missing?: boolean;
  }): void {
    const id = nextId('tx');
    this.add('courierWalletTransaction', {
      id,
      txnId: `MTX-${id}`,
      courierAccountId: spec.account ?? 'ca-dlv',
      awbNumber: spec.awb === undefined ? null : spec.awb,
      courierOrderRef: spec.ref ?? null,
      kind: spec.kind,
      category: spec.category ?? 'ADJUSTMENT',
      amountInr: D(spec.amount),
      occurredAt: spec.at,
      status: spec.status ?? 'success',
      shipmentStatus: null,
      missingFromExportAt: spec.missing === true ? IN : null,
    });
  }

  freight(total: string, cost: string | null, at: Date, extra: Row = {}): string {
    const id = nextId('ifc');
    this.add('inboundFreightCharge', {
      id,
      totalInr: D(total),
      ourCostInr: cost === null ? null : D(cost),
      status: 'PENDING',
      amountSettledInr: D('0'),
      createdAt: at,
      consignmentId: null,
      sellerId: 's-1',
      ...extra,
    });
    return id;
  }

  /**
   * A payout, typed as received at `receivedAt` and RECORDED at
   * `recordedAt` (default: the same instant), with one line per shortfall.
   */
  settlement(
    receivedAt: Date,
    shortfalls: string[],
    opts: {
      recordedAt?: Date;
      amount?: string;
      allocated?: string;
      earlyFee?: string;
      freight?: string;
    } = {},
  ): string {
    const sid = nextId('set');
    const recordedAt = opts.recordedAt ?? receivedAt;
    this.add('courierSettlement', {
      id: sid,
      reference: `UTR-${sid}`,
      receivedAt,
      createdAt: recordedAt,
      amountInr: D(opts.amount ?? '0'),
      allocatedInr: D(opts.allocated ?? '0'),
      earlyCodFeeInr: D(opts.earlyFee ?? '0'),
      freightDeductedInr: D(opts.freight ?? '0'),
    });
    for (const s of shortfalls) this.settlementLine(sid, s, recordedAt);
    return sid;
  }

  /** A line on an existing payout, written at `recordedAt` — `allocateMore`'s shape. */
  settlementLine(settlementId: string, shortfall: string, recordedAt: Date): void {
    const orderId = this.order({});
    this.add('courierSettlementLine', {
      id: nextId('sl'),
      settlementId,
      orderId,
      shortfallInr: D(shortfall),
      createdAt: recordedAt,
    });
  }

  investment(placed: string, returned: string, closedAt: Date, currency = 'INR'): void {
    this.add('investment', {
      id: nextId('inv'),
      label: `FD ${currency}`,
      counterparty: 'HDFC',
      currency,
      placedInr: D(placed),
      returnedInr: D(returned),
      closedAt,
    });
  }

  /** "1 INR = `bdtPerInr` BDT", recorded at `at`. */
  rateHistory(bdtPerInr: string, at: Date): void {
    this.add('fxRateHistory', {
      id: nextId('fxh'),
      fromCurrency: 'INR',
      toCurrency: 'BDT',
      rate: D(bdtPerInr),
      recordedAt: at,
    });
  }

  todayRate(bdtPerInr: string): void {
    this.add('fxRate', { fromCurrency: 'INR', toCurrency: 'BDT', rate: D(bdtPerInr) });
  }
}

async function drill(
  svc: PnlService,
  key: string,
  from = FROM,
  to = TO,
): Promise<{
  items: Awaited<ReturnType<PnlService['lineItems']>>['items'];
  revenue: string;
  cost: string;
}> {
  const { items, truncated } = await svc.lineItems(key, from, to, 1000);
  expect(truncated).toBe(false);
  return {
    items,
    revenue: total(items.map((i) => i.revenueInr)),
    cost: total(items.map((i) => i.costInr)),
  };
}

describe('PnlService', () => {
  it('reports an unpriced cost as UNCOVERED, never as profit', async () => {
    // Two consignments billed, one forwarder invoice recorded. Treating
    // the missing one as zero would report a 100% margin on it.
    const w = new World();
    w.freight('10000', '7000', IN);
    w.freight('10000', null, IN);
    const r = await w.svc().report(FROM, TO);
    const l = line(r, 'inbound_freight');
    expect(l?.revenueInr).toBe('20000.00');
    expect(l?.costInr).toBe('7000.00');
    expect(l?.coverage).toMatchObject({ priced: 1, total: 2 });
    expect(l?.coverage.note).not.toBeNull();
    expect(r.complete).toBe(false);
  });

  it('says it is complete only when every line is fully measured', async () => {
    const w = new World();
    w.freight('100', '60', IN);
    w.order({
      events: [['DELIVERED', IN]],
      charges: [['BASE_SHIPPING', '500']],
      shipments: [{ fwd: '300' }],
    });
    w.order({
      events: [['RTO_RECEIVED', IN]],
      charges: [['RTO_FEE', '30']],
      shipments: [{ rto: '20' }],
    });
    const r = await w.svc().report(FROM, TO);
    expect(r.complete).toBe(true);
    expect(r.lines.every((l) => l.coverage.note === null)).toBe(true);
  });

  it('nets the sources into gross margin and subtracts expenses', async () => {
    const w = new World();
    w.freight('1000', '600', IN); // +400
    w.order({
      events: [['DELIVERED', IN]],
      charges: [['BASE_SHIPPING', '2000']],
      shipments: [{ fwd: '1500' }],
    }); // +500
    w.order({
      events: [['RTO_RECEIVED', IN]],
      charges: [['RTO_FEE', '200']],
      shipments: [{ rto: '150' }],
    }); // +50
    w.bank({ type: 'FX_SPREAD', amount: '75', at: IN }); // +75
    w.bank({ type: 'EXPENSE', amount: '-325', at: IN, expenseCategoryId: 'cat-rent' });
    const r = await w.svc().report(FROM, TO);
    expect(r.grossMarginInr).toBe('1025.00');
    expect(r.operatingExpensesInr).toBe('325.00');
    expect(r.netInr).toBe('700.00');
  });

  it('carries a negative FX spread through as a loss, not an absolute', async () => {
    const w = new World();
    w.bank({ type: 'FX_SPREAD', amount: '-120', at: IN });
    const r = await w.svc().report(FROM, TO);
    expect(line(r, 'fx')?.marginInr).toBe('-120.00');
    expect(r.grossMarginInr).toBe('-120.00');
  });

  it('reports no percentage where there is no revenue to take one of', async () => {
    const r = await new World().svc().report(FROM, TO);
    for (const l of r.lines) expect(l.marginPercent).toBeNull();
  });

  it('an empty window is zero everywhere, and complete', async () => {
    const r = await new World().svc().report(FROM, TO);
    expect(r.grossMarginInr).toBe('0.00');
    expect(r.netInr).toBe('0.00');
    expect(r.complete).toBe(true);
    expect(r.lines.map((l) => l.key)).toEqual([...PNL_LINE_KEYS]);
  });

  it('never charges a returned parcel twice — a delivered-then-returned order is on RETURNS only', async () => {
    const w = new World();
    w.order({
      events: [['DELIVERED', IN]],
      charges: [['BASE_SHIPPING', '1000']],
      shipments: [{ fwd: '700' }],
    });
    w.order({
      events: [
        ['DELIVERED', T('2026-08-05T00:00:00Z')],
        ['RTO_RECEIVED', T('2026-08-20T00:00:00Z')],
      ],
      charges: [
        ['BASE_SHIPPING', '200'],
        ['RTO_FEE', '30'],
      ],
      shipments: [{ fwd: '0', rto: '180' }],
    });
    const r = await w.svc().report(FROM, TO);
    expect(line(r, 'delivery')).toMatchObject({ revenueInr: '1000.00', costInr: '700.00' });
    expect(line(r, 'rto')).toMatchObject({ revenueInr: '230.00', costInr: '180.00' });
    expect(r.grossMarginInr).toBe('350.00');
  });

  it('a returned parcel billed on BOTH legs counts both on the returns line', async () => {
    // A manual courier bills the delivery and the return and refunds neither.
    const w = new World();
    w.order({ events: [['RTO_RECEIVED', IN]], shipments: [{ fwd: '62', rto: '48' }] });
    const r = await w.svc().report(FROM, TO);
    expect(line(r, 'rto')?.costInr).toBe('110.00');
  });
});

describe('COD the courier short-paid or reversed', () => {
  it('a short-payment we absorbed is a cost, and a later recovery comes back off it', async () => {
    const w = new World();
    w.settlement(IN, ['50', '30', '-20']);
    const r = await w.svc().report(FROM, TO);
    expect(line(r, 'cod_shortfall')).toMatchObject({ revenueInr: '0.00', costInr: '60.00' });
    expect(r.grossMarginInr).toBe('-60.00');
  });

  it('tax withheld on a COD the courier reversed is not revenue', async () => {
    const w = new World();
    const tax = w.wallet('GST_WITHHOLDING', '152.54', IN);
    w.wallet('COD_DEDUCTION_REFUND', '152.54', IN, { linkedEntryId: tax['id'] });
    const r = await w.svc().report(FROM, TO);
    expect(line(r, 'cod_tax')?.revenueInr).toBe('0.00');
  });

  it('a fee taken on a reversed COD comes off the COD handling fees — and not off the tax', async () => {
    const w = new World();
    const fee = w.wallet('INSTANT_PAY_FEE', '50.00', IN);
    w.wallet('COD_DEDUCTION_REFUND', '21.19', IN, { linkedEntryId: fee['id'] });
    w.wallet('GST_WITHHOLDING', '76.27', IN);
    const r = await w.svc().report(FROM, TO);
    expect(line(r, 'cod_service_fees')?.revenueInr).toBe('28.81');
    expect(line(r, 'cod_tax')?.revenueInr).toBe('76.27');
  });
});

describe('ShipmentCostService', () => {
  function makeSut(existing: {
    actualCourierCostInr: Prisma.Decimal | null;
    actualRtoCostInr: Prisma.Decimal | null;
  }) {
    const update = jest.fn<Promise<unknown>, [{ where: unknown; data: Record<string, unknown> }]>(
      async (args) => ({
        actualCourierCostInr:
          (args.data['actualCourierCostInr'] as Prisma.Decimal | undefined) ??
          existing.actualCourierCostInr,
        actualRtoCostInr:
          (args.data['actualRtoCostInr'] as Prisma.Decimal | undefined) ??
          existing.actualRtoCostInr,
      }),
    );
    const prisma = {
      client: {
        shipment: { findFirst: async () => ({ id: 'sh1', ...existing }), update },
      },
    } as unknown as PrismaService;
    const audit = { log: jest.fn(async () => 'a1') } as unknown as AuditLogService;
    return { svc: new ShipmentCostService(prisma, audit), update };
  }

  const EMPTY = { actualCourierCostInr: null, actualRtoCostInr: null };

  it('keeps the forward and return figures in SEPARATE columns', async () => {
    const sut = makeSut(EMPTY);
    await sut.svc.record('staff-1', 'sh1', { forwardCostInr: '62', rtoCostInr: '48' });
    const data = sut.update.mock.calls[0]?.[0].data;
    expect(String(data?.['actualCourierCostInr'])).toBe('62');
    expect(String(data?.['actualRtoCostInr'])).toBe('48');
  });

  it('leaves the other figure untouched when only one is given', async () => {
    const sut = makeSut({ actualCourierCostInr: new Prisma.Decimal('62'), actualRtoCostInr: null });
    await sut.svc.record('staff-1', 'sh1', { rtoCostInr: '48' });
    const data = sut.update.mock.calls[0]?.[0].data;
    expect(data).not.toHaveProperty('actualCourierCostInr');
    expect(String(data?.['actualRtoCostInr'])).toBe('48');
  });

  it('refuses a negative cost and an empty submission', async () => {
    const sut = makeSut(EMPTY);
    await expect(sut.svc.record('staff-1', 'sh1', { forwardCostInr: '-5' })).rejects.toMatchObject({
      response: { code: 'COST_INVALID' },
    });
    await expect(sut.svc.record('staff-1', 'sh1', {})).rejects.toMatchObject({
      response: { code: 'NO_COST_GIVEN' },
    });
  });
});

describe('a cost already counted by its leg is not counted again', () => {
  it('excludes freight payments LINKED to a bill from operating expenses', async () => {
    // Enter the forwarder cost on the bill AND its payment as an expense,
    // and the same rupees come off gross AND off net — unless the linked
    // payment is left out of operating expenses.
    const w = new World();
    w.bank({ type: 'EXPENSE', amount: '-600', at: IN, inboundFreightChargeId: 'ifc-x' });
    w.bank({ type: 'EXPENSE', amount: '-325', at: IN, expenseCategoryId: 'cat-rent' });
    const r = await w.svc().report(FROM, TO);
    expect(r.operatingExpensesInr).toBe('325.00');
  });

  it('REPORTS a leg cost nobody attributed rather than hiding it', async () => {
    const w = new World();
    w.bank({ type: 'EXPENSE', amount: '-2000', at: IN, expenseCategoryId: 'cat-fwd' });
    w.bank({ type: 'EXPENSE', amount: '-500', at: IN, expenseCategoryId: 'cat-fwd' });
    const r = await w.svc().report(FROM, TO);
    expect(r.unattributedLegCosts).toMatchObject({
      amountInr: '2500.00',
      count: 2,
      unconverted: 0,
    });
  });

  it('says nothing when there is nothing to say', async () => {
    const r = await new World().svc().report(FROM, TO);
    expect(r.unattributedLegCosts).toBeNull();
  });
});

describe('the tax deducted from a COD is OURS', () => {
  it('reports it as revenue with no cost side', async () => {
    const w = new World();
    w.wallet('GST_WITHHOLDING', '608.64', IN);
    const r = await w.svc().report(FROM, TO);
    const l = line(r, 'cod_tax');
    expect(l).toMatchObject({ revenueInr: '608.64', costInr: '0.00', marginInr: '608.64' });
    expect(l?.basis.cost).toHaveLength(0);
  });

  it('does NOT take the return fee as its figure', async () => {
    const w = new World();
    w.order({ events: [['RTO_RECEIVED', IN]], charges: [['RTO_FEE', '200']] });
    w.wallet('GST_WITHHOLDING', '608.64', IN);
    const r = await w.svc().report(FROM, TO);
    expect(line(r, 'rto')?.revenueInr).toBe('200.00');
    expect(line(r, 'cod_tax')?.revenueInr).toBe('608.64');
  });
});

/**
 * What the courier charged the ACCOUNT rather than a parcel —
 * reconciliations, lost-shipment settlements, fraud credit notes.
 */
describe('courier account adjustments', () => {
  it('a debit is a cost, a credit gives it back, there is no revenue, and all of it is measured', async () => {
    const w = new World();
    w.txn({ kind: 'DEBIT', amount: '1050.00', at: IN });
    w.txn({ kind: 'DEBIT', amount: '1050.00', at: IN });
    w.txn({ kind: 'CREDIT', amount: '1290.00', at: IN });
    const r = await w.svc().report(FROM, TO);
    const l = line(r, 'courier_adjustments');
    expect(l).toMatchObject({ revenueInr: '0.00', costInr: '810.00', marginInr: '-810.00' });
    expect(l?.coverage).toMatchObject({ priced: 3, total: 3 });
    expect(l?.basis.cost.map((b) => b.count)).toEqual([2, 1]);
  });

  it('is silent when the courier made none', async () => {
    const l = line(await new World().svc().report(FROM, TO), 'courier_adjustments');
    expect(l?.costInr).toBe('0.00');
    expect(l?.coverage.note).toBeNull();
  });

  it('counts by the TRANSACTION date, successful only, never a dropped one — and the window is half-open', async () => {
    const w = new World();
    w.txn({ kind: 'DEBIT', amount: '100', at: IN });
    w.txn({ kind: 'DEBIT', amount: '20', at: FROM }); // the first instant: inside
    w.txn({ kind: 'DEBIT', amount: '30', at: TO }); // the next window's first instant
    w.txn({ kind: 'DEBIT', amount: '50', at: IN, status: 'failed' });
    w.txn({ kind: 'DEBIT', amount: '70', at: IN, missing: true });
    const svc = w.svc();
    expect(line(await svc.report(FROM, TO), 'courier_adjustments')?.costInr).toBe('120.00');
    const rows = await drill(svc, 'courier_adjustments');
    expect(rows.items.map((i) => i.costInr).sort()).toEqual(['100.00', '20.00']);
  });
});

/**
 * Before 1 Oct 2026 the courier accounts carried the business's parcels
 * shipped OUTSIDE Skydrop; their account adjustments are not ours.
 */
describe('courier account adjustments — only from the cutover', () => {
  it('counts from the cutover when it falls inside the window, and says what it left out', async () => {
    const from = T('2026-09-15T00:00:00Z');
    const to = T('2026-10-15T00:00:00Z');
    const w = new World().cutover(CUTOVER);
    w.txn({ kind: 'DEBIT', amount: '100.00', at: T('2026-10-05T00:00:00Z') });
    w.txn({ kind: 'DEBIT', amount: '9206.66', at: T('2026-09-20T00:00:00Z') });
    w.txn({ kind: 'CREDIT', amount: '5280.00', at: T('2026-09-25T00:00:00Z') });
    w.txn({ kind: 'CREDIT', amount: '5280.00', at: T('2026-09-26T00:00:00Z') });
    const l = line(await w.svc().report(from, to), 'courier_adjustments');
    expect(l?.costInr).toBe('100.00');
    expect(l?.coverage.note).toMatch(/3 adjustment\(s\) dated before 1 Oct 2026/);
    expect(l?.coverage.note).toMatch(/net credit ₹1353\.34/);
  });

  it('a window wholly before the cutover counts nothing — and still says why', async () => {
    const w = new World().cutover(CUTOVER);
    w.txn({ kind: 'DEBIT', amount: '999.00', at: IN });
    w.txn({ kind: 'CREDIT', amount: '500.00', at: IN });
    const l = line(await w.svc().report(FROM, TO), 'courier_adjustments');
    expect(l?.costInr).toBe('0.00');
    expect(l?.coverage.note).toMatch(/2 adjustment\(s\).*net debit ₹499\.00.*not counted/);
  });

  it('a window ENDING exactly at the cutover counts nothing (the cutover instant is the next window’s)', async () => {
    const w = new World().cutover(CUTOVER);
    w.txn({ kind: 'DEBIT', amount: '10.00', at: CUTOVER });
    const svc = w.svc();
    const before = await svc.report(T('2026-09-15T00:00:00Z'), CUTOVER);
    const after = await svc.report(CUTOVER, T('2026-10-15T00:00:00Z'));
    expect(line(before, 'courier_adjustments')?.costInr).toBe('0.00');
    expect(line(after, 'courier_adjustments')?.costInr).toBe('10.00');
  });

  it('a window wholly after the cutover counts everything in it, and says nothing', async () => {
    const w = new World().cutover(CUTOVER);
    w.txn({ kind: 'DEBIT', amount: '40.00', at: T('2026-11-10T00:00:00Z') });
    const l = line(
      await w.svc().report(T('2026-11-01T00:00:00Z'), T('2026-12-01T00:00:00Z')),
      'courier_adjustments',
    );
    expect(l?.costInr).toBe('40.00');
    expect(l?.coverage.note).toBeNull();
  });

  it('with the setting cleared every adjustment counts', async () => {
    const w = new World();
    w.txn({ kind: 'DEBIT', amount: '40.00', at: IN });
    expect(line(await w.svc().report(FROM, TO), 'courier_adjustments')?.costInr).toBe('40.00');
  });
});

describe('courier COD fees', () => {
  it('are their own cost line, and NOT also an operating expense', async () => {
    const w = new World();
    w.bank({ type: 'EXPENSE', amount: '-90', at: IN, settlementId: 'set-x' });
    w.bank({ type: 'EXPENSE', amount: '-325', at: IN, expenseCategoryId: 'cat-rent' });
    const r = await w.svc().report(FROM, TO);
    const l = line(r, 'courier_cod_fees');
    expect(l).toMatchObject({ costInr: '90.00', revenueInr: '0.00' });
    expect(l?.coverage).toMatchObject({ priced: 1, total: 1 });
    expect(r.operatingExpensesInr).toBe('325.00');
    expect(r.grossMarginInr).toBe('-90.00');
    expect(r.netInr).toBe('-415.00');
  });

  it('is zero and complete when no payout carried a fee', async () => {
    const r = await new World().svc().report(FROM, TO);
    expect(line(r, 'courier_cod_fees')?.costInr).toBe('0.00');
    expect(r.complete).toBe(true);
  });
});

describe('the P&L counts what it used to miss', () => {
  it('a returned parcel earns its delivery fee AND its return fee', async () => {
    const w = new World();
    w.order({
      events: [['RTO_RECEIVED', IN]],
      charges: [
        ['BASE_SHIPPING', '200'],
        ['RTO_FEE', '30'],
      ],
      shipments: [{ rto: '151.91' }],
    });
    const r = await w.svc().report(FROM, TO);
    expect(line(r, 'rto')).toMatchObject({ revenueInr: '230.00', costInr: '151.91' });
  });

  it('takes a refunded delivery fee back off delivery revenue — only on orders IN the cohort', async () => {
    const w = new World();
    w.order({
      events: [['DELIVERED', IN]],
      charges: [['BASE_SHIPPING', '600']],
      refunds: ['200'],
    });
    // A cancelled order's refund is nothing to do with this line: its fee
    // was taken and given back, so it carries no money and is no row.
    w.order({
      events: [['CANCELLED', IN]],
      charges: [['BASE_SHIPPING', '100']],
      debits: ['100'],
      refunds: ['100'],
    });
    const r = await w.svc().report(FROM, TO);
    expect(line(r, 'delivery')?.revenueInr).toBe('400.00');
  });

  it('a waived freight bill earns only what was charged before the waiver — in the total AND its rows', async () => {
    const w = new World();
    w.freight('1000', '600', IN);
    w.freight('800', '500', IN, { status: 'WAIVED', amountSettledInr: D('300') });
    const svc = w.svc();
    const r = await svc.report(FROM, TO);
    expect(line(r, 'inbound_freight')).toMatchObject({ revenueInr: '1300.00', costInr: '1100.00' });
    expect((await drill(svc, 'inbound_freight')).revenue).toBe('1300.00');
  });

  it('counts Instant Pay and COD collection fees as revenue', async () => {
    const w = new World();
    w.wallet('INSTANT_PAY_FEE', '82.60', IN);
    w.wallet('COD_COLLECTION_FEE', '10.00', IN);
    const r = await w.svc().report(FROM, TO);
    expect(line(r, 'cod_service_fees')).toMatchObject({ revenueInr: '92.60', costInr: '0.00' });
  });

  it('counts what we paid sellers for damaged or lost goods as a cost', async () => {
    const w = new World();
    w.wallet('SCRAP_REFUND', '1250', IN);
    const r = await w.svc().report(FROM, TO);
    expect(line(r, 'damage_refunds')).toMatchObject({ costInr: '1250.00', marginInr: '-1250.00' });
  });

  it('a charge under a waybill Shiprocket replaced is that parcel’s, not “no Skydrop parcel”', async () => {
    const w = new World();
    w.shipment({ courierCode: 'shiprocket', awb: 'NEW-AWB', courierOrderId: 'SR-ORDER-1' });
    w.txn({
      kind: 'DEBIT',
      amount: '60',
      at: IN,
      category: 'PARCEL',
      awb: 'OLD-AWB',
      ref: 'SR-ORDER-1',
      account: 'ca-sr',
    });
    const r = await w.svc().report(FROM, TO);
    expect(line(r, 'courier_unmatched')?.costInr).toBe('0.00');
  });

  it('counts courier charges on a waybill that is no live Skydrop parcel — and only those', async () => {
    const w = new World();
    w.shipment({ awb: 'OURS' });
    w.shipment({ awb: 'VOIDED', deleted: true });
    w.txn({ kind: 'DEBIT', amount: '90.36', at: IN, category: 'PARCEL', awb: 'OURS' });
    w.txn({ kind: 'DEBIT', amount: '48.36', at: IN, category: 'PARCEL', awb: 'VOIDED' });
    w.txn({ kind: 'CREDIT', amount: '10.00', at: IN, category: 'PARCEL', awb: 'VOIDED' });
    const r = await w.svc().report(FROM, TO);
    expect(line(r, 'courier_unmatched')).toMatchObject({ costInr: '38.36' });
    expect(line(r, 'courier_unmatched')?.coverage).toMatchObject({ priced: 1, total: 1 });
  });

  it('puts a taka FX spread in rupees at its own transfer’s rate', async () => {
    // ₹10,000 sent, ৳13,200 received: a taka is 10000/13200 of a rupee.
    const w = new World();
    const tr = w.transfer('10000', 'INR', '13200', 'BDT');
    w.bank({ type: 'FX_SPREAD', amount: '132', currency: 'BDT', at: IN, transferId: tr });
    expect(line(await w.svc().report(FROM, TO), 'fx')?.revenueInr).toBe('100.00');
  });

  it('puts a taka expense in rupees at the rate in force — and leaves one out, loudly, when there is none', async () => {
    const withRate = new World();
    withRate.bank({ type: 'EXPENSE', amount: '-500', at: IN, expenseCategoryId: 'cat-rent' });
    withRate.bank({ type: 'EXPENSE', amount: '-1320', currency: 'BDT', at: IN });
    withRate.rateHistory('1.32', T('2026-07-01T00:00:00Z'));
    const a = await withRate.svc().report(FROM, TO);
    expect(a.operatingExpensesInr).toBe('1500.00');
    expect(a.warnings).toEqual([]);

    const noRate = new World();
    noRate.bank({ type: 'EXPENSE', amount: '-500', at: IN, expenseCategoryId: 'cat-rent' });
    noRate.bank({ type: 'EXPENSE', amount: '-1320', currency: 'BDT', at: IN });
    const b = await noRate.svc().report(FROM, TO);
    expect(b.operatingExpensesInr).toBe('500.00');
    expect(b.complete).toBe(false);
    expect(b.warnings[0]).toMatch(/no exchange rate/);
  });

  it('counts OUR bank reconciliation differences, not a seller’s, and investment income', async () => {
    const w = new World();
    w.bank({ type: 'OWNER_CONTRIBUTION', amount: '5000', at: T('2026-07-01T00:00:00Z') });
    w.bank({ type: 'RECONCILIATION_ADJUSTMENT', amount: '-35.40', at: IN });
    w.bank({ type: 'RECONCILIATION_ADJUSTMENT', amount: '99', at: IN, ownerKind: 'SELLER' });
    w.investment('100000', '101500', IN);
    const r = await w.svc().report(FROM, TO);
    expect(line(r, 'bank_reconciliation')?.revenueInr).toBe('-35.40');
    expect(line(r, 'investment_income')?.revenueInr).toBe('1500.00');
  });

  it('an account’s OPENING balance is capital put in, not income — and it says so', async () => {
    const w = new World();
    w.bank({ type: 'RECONCILIATION_ADJUSTMENT', amount: '100000', at: IN, isOpeningBalance: true });
    w.bank({ type: 'RECONCILIATION_ADJUSTMENT', amount: '-12.00', at: IN });
    const r = await w.svc().report(FROM, TO);
    const recon = line(r, 'bank_reconciliation');
    expect(recon?.revenueInr).toBe('-12.00');
    expect(recon?.coverage).toMatchObject({ priced: 1, total: 1 });
    expect(recon?.coverage.note).toContain('opening balance');
    expect(r.netInr).toBe('-12.00');
  });
});

describe('recognised when the parcel’s fate is known', () => {
  it('an order not yet delivered earns nothing on the delivery line, however it was billed', async () => {
    const w = new World();
    for (let i = 0; i < 3; i++) {
      w.order({
        status: 'IN_TRANSIT',
        charges: [['BASE_SHIPPING', '200']],
        shipments: [{ fwd: '30' }],
      });
    }
    const r = await w.svc().report(FROM, TO);
    expect(line(r, 'delivery')).toMatchObject({ revenueInr: '0.00', costInr: '0.00' });
    expect(line(r, 'delivery')?.coverage.note).toMatch(
      /3 parcel\(s\) on orders not yet delivered, returned or called off hold a waybill/,
    );
  });

  it('charges on a VOIDED Skydrop parcel count whatever the cutover; a stranger’s only after it', async () => {
    const w = new World().cutover(CUTOVER);
    w.shipment({ awb: 'DEAD', deleted: true });
    w.txn({ kind: 'DEBIT', amount: '40.00', at: IN, category: 'PARCEL', awb: 'DEAD' });
    w.txn({ kind: 'DEBIT', amount: '25.00', at: IN, category: 'PARCEL', awb: 'STRANGER' });
    expect(line(await w.svc().report(FROM, TO), 'courier_unmatched')?.costInr).toBe('40.00');
  });

  it('a live parcel of ANOTHER courier sharing the waybill does not absorb the charge', async () => {
    const w = new World();
    w.shipment({ awb: 'SHARED', courierCode: 'shiprocket' });
    w.txn({ kind: 'DEBIT', amount: '33.00', at: IN, category: 'PARCEL', awb: 'SHARED' });
    expect(line(await w.svc().report(FROM, TO), 'courier_unmatched')?.costInr).toBe('33.00');
  });

  it('investment income on a taka account is put in rupees at the rate the day it closed', async () => {
    // ৳1,500 earned; 1 INR = 1.32 BDT → ₹1,136.36, not ₹1,500.
    const w = new World();
    w.investment('100000', '101500', IN, 'BDT');
    w.rateHistory('1.32', T('2026-07-01T00:00:00Z'));
    expect(line(await w.svc().report(FROM, TO), 'investment_income')?.revenueInr).toBe('1136.36');
  });

  it('an amount converted at TODAY’s rate is converted — and the report says so', async () => {
    const w = new World();
    w.bank({ type: 'EXPENSE', amount: '-500', at: IN, expenseCategoryId: 'cat-rent' });
    w.bank({ type: 'EXPENSE', amount: '-1320', currency: 'BDT', at: IN });
    w.todayRate('1.32');
    const r = await w.svc().report(FROM, TO);
    expect(r.operatingExpensesInr).toBe('1500.00');
    expect(r.warnings.some((x) => /today's rate/.test(x))).toBe(true);
  });
});

// ── The audit of 2026-09-12, item by item ──────────────────────────────

describe('X1 — every line has its rows', () => {
  it('courier account adjustments: only what the total counts, signed, from the cutover', async () => {
    const from = T('2026-09-15T00:00:00Z');
    const to = T('2026-10-15T00:00:00Z');
    const w = new World().cutover(CUTOVER);
    w.txn({ kind: 'DEBIT', amount: '100.00', at: T('2026-10-05T00:00:00Z') });
    w.txn({ kind: 'CREDIT', amount: '40.00', at: T('2026-10-07T00:00:00Z') });
    w.txn({ kind: 'DEBIT', amount: '9206.66', at: T('2026-09-20T00:00:00Z') }); // before cutover
    w.txn({ kind: 'DEBIT', amount: '77.00', at: T('2026-10-06T00:00:00Z'), missing: true });
    const svc = w.svc();
    const l = line(await svc.report(from, to), 'courier_adjustments');
    const rows = await drill(svc, 'courier_adjustments', from, to);
    expect(l?.costInr).toBe('60.00');
    expect(rows.items.map((i) => i.costInr)).toEqual(['-40.00', '100.00']);
    expect(rows.cost).toBe('60.00');
  });

  it('courier charges on no live parcel: one row per waybill, netted, dead and stray', async () => {
    const w = new World().cutover(T('2026-08-15T00:00:00Z'));
    w.shipment({ awb: 'LIVE' });
    w.shipment({ awb: 'DEAD', deleted: true });
    w.txn({ kind: 'DEBIT', amount: '90', at: IN, category: 'PARCEL', awb: 'LIVE' });
    w.txn({ kind: 'DEBIT', amount: '48.36', at: IN, category: 'PARCEL', awb: 'DEAD' });
    w.txn({ kind: 'CREDIT', amount: '10', at: IN, category: 'PARCEL', awb: 'DEAD' });
    // A stranger: only its charges from the cutover count.
    w.txn({
      kind: 'DEBIT',
      amount: '11',
      at: T('2026-08-05T00:00:00Z'),
      category: 'PARCEL',
      awb: 'X',
    });
    w.txn({
      kind: 'DEBIT',
      amount: '25',
      at: T('2026-08-20T00:00:00Z'),
      category: 'PARCEL',
      awb: 'X',
    });
    const svc = w.svc();
    const l = line(await svc.report(FROM, TO), 'courier_unmatched');
    const rows = await drill(svc, 'courier_unmatched');
    expect(l?.costInr).toBe('63.36');
    expect(rows.items.map((i) => [i.ref, i.costInr])).toEqual([
      ['X', '25.00'],
      ['DEAD', '38.36'],
    ]);
    expect(rows.cost).toBe('63.36');
  });

  it('bank reconciliation: counted rows in rupees, the opening balance listed and NOT counted', async () => {
    const w = new World();
    w.bank({ type: 'RECONCILIATION_ADJUSTMENT', amount: '100000', at: IN, isOpeningBalance: true });
    w.bank({ type: 'RECONCILIATION_ADJUSTMENT', amount: '-12.00', at: IN });
    w.bank({ type: 'OWNER_CONTRIBUTION', amount: '1000', currency: 'BDT', at: T('2026-07-01Z') });
    w.bank({ type: 'RECONCILIATION_ADJUSTMENT', amount: '500', currency: 'BDT', at: IN });
    w.rateHistory('1.32', T('2026-07-01T00:00:00Z'));
    const svc = w.svc();
    const l = line(await svc.report(FROM, TO), 'bank_reconciliation');
    const rows = await drill(svc, 'bank_reconciliation');
    // ৳500 at 1/1.32 = ₹378.79; −12 + 378.79.
    expect(l?.revenueInr).toBe('366.79');
    expect(rows.revenue).toBe('366.79');
    const opening = rows.items.find((i) => i.subRef?.includes('opening balance'));
    expect(opening?.revenueInr).toBeNull();
    expect(rows.items).toHaveLength(3);
  });

  it('investment income: each investment in rupees at its close-date rate', async () => {
    const w = new World();
    w.investment('100000', '101500', IN);
    w.investment('50000', '51500', T('2026-08-26T00:00:00Z'), 'BDT');
    w.rateHistory('1.32', T('2026-07-01T00:00:00Z'));
    const svc = w.svc();
    const l = line(await svc.report(FROM, TO), 'investment_income');
    const rows = await drill(svc, 'investment_income');
    expect(l?.revenueInr).toBe('2636.36');
    expect(rows.items.map((i) => i.revenueInr)).toEqual(['1136.36', '1500.00']);
  });
});

describe('X2 — the FX rows are in RUPEES, as the total is', () => {
  it('a ৳7.00 spread shows as ₹5.38 at its own transfer’s rate, not as 7.00', async () => {
    const w = new World();
    const tr = w.transfer('10000', 'INR', '13000', 'BDT');
    w.bank({ type: 'FX_SPREAD', amount: '7.00', currency: 'BDT', at: IN, transferId: tr });
    const svc = w.svc();
    const rows = await drill(svc, 'fx');
    expect(line(await svc.report(FROM, TO), 'fx')?.revenueInr).toBe('5.38');
    expect(rows.items[0]?.revenueInr).toBe('5.38');
    expect(rows.items[0]?.subRef).toContain('7.00 BDT');
  });

  it('a payout’s realised FX converts at THAT payout’s rate, and its row adds up to the line', async () => {
    // ₹500 paid out as ৳625: a taka is ₹0.80 on this payout. ৳25 more than
    // the seller's book was worth went out — ₹20 of realised FX, ours.
    const w = new World();
    w.add('remittance', {
      id: 'rem-1',
      amount: D('625'),
      currency: 'BDT',
      sourceAmount: D('500'),
      sourceCurrency: 'INR',
    });
    w.bank({ type: 'FX_SPREAD', amount: '-25', currency: 'BDT', at: IN, remittanceId: 'rem-1' });
    const svc = w.svc();
    const rows = await drill(svc, 'fx');
    expect(line(await svc.report(FROM, TO), 'fx')?.revenueInr).toBe('-20.00');
    expect(rows.revenue).toBe('-20.00');
  });
});

describe('the opening balance is what the operator MARKED, not whatever came first', () => {
  it('a correction written before the marked opening balance is still counted', async () => {
    // A charge's reclassification, a transfer or a payout can post a
    // capital row before anybody enters the balance. "First capital entry"
    // then named the wrong row — and a real ৳100,000 opening balance read
    // as income.
    const w = new World();
    w.bank({ type: 'RECONCILIATION_ADJUSTMENT', amount: '500', at: IN });
    w.bank({ type: 'RECONCILIATION_ADJUSTMENT', amount: '100000', at: IN, isOpeningBalance: true });
    const svc = w.svc();
    const rows = await drill(svc, 'bank_reconciliation');
    expect(line(await svc.report(FROM, TO), 'bank_reconciliation')?.revenueInr).toBe('500.00');
    expect(rows.revenue).toBe('500.00');
  });
});

describe('X3 — a deduction returned on a reversed COD is a row, as a negative', () => {
  it('COD tax: the refund is listed under the deductions and the rows add up', async () => {
    const w = new World();
    const tax = w.wallet('GST_WITHHOLDING', '152.54', T('2026-08-03T00:00:00Z'));
    w.wallet('GST_WITHHOLDING', '76.27', T('2026-08-16T00:00:00Z'));
    w.wallet('COD_DEDUCTION_REFUND', '152.54', T('2026-08-20T00:00:00Z'), {
      linkedEntryId: tax['id'],
    });
    const svc = w.svc();
    const rows = await drill(svc, 'cod_tax');
    expect(rows.items.map((i) => i.revenueInr)).toEqual(['-152.54', '76.27', '152.54']);
    expect(rows.revenue).toBe(line(await svc.report(FROM, TO), 'cod_tax')?.revenueInr);
    expect(rows.revenue).toBe('76.27');
  });

  it('COD handling fees: only refunds of a FEE, never of the tax', async () => {
    const w = new World();
    const fee = w.wallet('INSTANT_PAY_FEE', '50.00', T('2026-08-04T00:00:00Z'));
    const tax = w.wallet('GST_WITHHOLDING', '100.00', T('2026-08-04T00:00:00Z'));
    w.wallet('COD_DEDUCTION_REFUND', '21.19', T('2026-08-19T00:00:00Z'), {
      linkedEntryId: fee['id'],
    });
    w.wallet('COD_DEDUCTION_REFUND', '100.00', T('2026-08-19T00:00:00Z'), {
      linkedEntryId: tax['id'],
    });
    const svc = w.svc();
    const rows = await drill(svc, 'cod_service_fees');
    expect(rows.items.map((i) => i.revenueInr)).toEqual(['-21.19', '50.00']);
    expect(rows.revenue).toBe('28.81');
    expect(line(await svc.report(FROM, TO), 'cod_service_fees')?.revenueInr).toBe('28.81');
  });
});

describe('X4 — a refund on a returned order comes off returns revenue', () => {
  it('₹200 delivery + ₹30 return fee, ₹30 refunded: ₹200 in the total and in its row', async () => {
    const w = new World();
    w.order({
      events: [['RTO_RECEIVED', IN]],
      charges: [
        ['BASE_SHIPPING', '200'],
        ['RTO_FEE', '30'],
      ],
      refunds: ['30'],
      shipments: [{ rto: '150' }],
    });
    const svc = w.svc();
    const l = line(await svc.report(FROM, TO), 'rto');
    expect(l?.revenueInr).toBe('200.00');
    expect(l?.basis.revenue.find((p) => p.label.startsWith('Refunded'))?.amountInr).toBe('-30.00');
    expect((await drill(svc, 'rto')).revenue).toBe('200.00');
  });
});

describe('X5 — a LOST parcel costs us its carriage, and earns only a fee still held on it', () => {
  // The owner's rule is that a lost parcel is not charged; on AT_AWB
  // timing it was debited at booking, and the P&L must read true whether
  // or not that has been refunded yet.
  it('debited and never refunded: the fee is revenue until it goes back, and the report says it is owed', async () => {
    const w = new World();
    w.order({
      events: [['LOST_IN_TRANSIT', IN]],
      charges: [
        ['BASE_SHIPPING', '200'],
        ['GST', '36'],
      ],
      shipments: [{ fwd: '120' }],
    });
    const svc = w.svc();
    const l = line(await svc.report(FROM, TO), 'delivery');
    expect(l).toMatchObject({ revenueInr: '236.00', costInr: '120.00', marginInr: '116.00' });
    expect(l?.basis.revenue).toEqual([
      expect.objectContaining({
        label: 'Fees debited on parcels lost in transit',
        count: 1,
        amountInr: '236.00',
      }),
    ]);
    expect(l?.basis.cost.find((p) => /lost in transit/.test(p.label))?.amountInr).toBe('120.00');
    expect(l?.coverage.note).toMatch(
      /1 parcel\(s\) were lost in transit: their courier cost \(₹120\.00\) is counted here; ₹236\.00 of fees debited on them is still held — a lost parcel is not charged/,
    );
    const rows = await drill(svc, 'delivery');
    expect(rows.items[0]).toMatchObject({ revenueInr: '236.00', costInr: '120.00' });
    expect(rows.items[0]?.subRef).toContain('lost in transit — ₹236.00 fee still held');
    expect(rows.revenue).toBe('236.00');
  });

  it('debited and refunded: nets to nothing, and says it was refunded', async () => {
    const w = new World();
    w.order({
      events: [['LOST_IN_TRANSIT', IN]],
      charges: [['BASE_SHIPPING', '200']],
      refunds: ['200'],
      shipments: [{ fwd: '120' }],
    });
    const svc = w.svc();
    const l = line(await svc.report(FROM, TO), 'delivery');
    expect(l).toMatchObject({ revenueInr: '0.00', costInr: '120.00' });
    expect(l?.basis.revenue.map((p) => [p.label, p.amountInr])).toEqual([
      ['Fees debited on parcels lost in transit', '200.00'],
      ['Refunded on parcels lost in transit', '-200.00'],
    ]);
    expect(l?.coverage.note).toMatch(/is counted here; ₹200\.00 was refunded\./);
    const rows = await drill(svc, 'delivery');
    expect(rows.items[0]).toMatchObject({ revenueInr: '0.00', costInr: '120.00' });
    expect(rows.items[0]?.subRef).toContain('lost in transit — fee refunded');
  });

  it('never debited: no revenue, and says nothing was billed', async () => {
    const w = new World();
    w.order({
      events: [['LOST_IN_TRANSIT', IN]],
      charges: [['BASE_SHIPPING', '200']],
      billed: false,
      shipments: [{ fwd: '120' }],
    });
    const svc = w.svc();
    const l = line(await svc.report(FROM, TO), 'delivery');
    expect(l).toMatchObject({ revenueInr: '0.00', costInr: '120.00', marginInr: '-120.00' });
    expect(l?.basis.revenue).toEqual([
      expect.objectContaining({ label: 'Lost in transit — never billed', amountInr: '0.00' }),
    ]);
    expect(l?.coverage.note).toMatch(/is counted here and nothing was billed for them\./);
    // A quote on a lost parcel is not "unbilled": nothing was owed.
    expect(l?.coverage.note).not.toMatch(/never debited/);
    const rows = await drill(svc, 'delivery');
    expect(rows.items[0]).toMatchObject({ revenueInr: '0.00', costInr: '120.00' });
    expect(rows.items[0]?.subRef).toContain('lost in transit — never billed');
  });

  it('the same lost parcel on its way BACK (₹0 forward, ₹151.91 return) still costs ₹151.91', async () => {
    const w = new World();
    w.order({ events: [['LOST_IN_TRANSIT', IN]], shipments: [{ fwd: '0', rto: '151.91' }] });
    expect(line(await w.svc().report(FROM, TO), 'delivery')?.costInr).toBe('151.91');
  });

  it('a parcel lost and then FOUND and delivered is billed as delivered', async () => {
    const w = new World();
    w.order({
      events: [
        ['LOST_IN_TRANSIT', T('2026-08-03T00:00:00Z')],
        ['DELIVERED', T('2026-08-09T00:00:00Z')],
      ],
      charges: [['BASE_SHIPPING', '200']],
      shipments: [{ fwd: '90' }],
    });
    expect(line(await w.svc().report(FROM, TO), 'delivery')?.revenueInr).toBe('200.00');
  });
});

describe('X6 — one row per ORDER, and an order with nothing to price is UNCOVERED', () => {
  it('a delivered order whose only parcel never got a waybill counts as uncovered, and has its row', async () => {
    const w = new World();
    w.order({
      events: [['DELIVERED', IN]],
      charges: [['BASE_SHIPPING', '200']],
      shipments: [{ fwd: '90' }],
    });
    w.order({
      number: 'SD-2026-QA-338994',
      events: [['DELIVERED', IN]],
      charges: [['BASE_SHIPPING', '200']],
      shipments: [{ awb: null }],
    });
    const svc = w.svc();
    const r = await svc.report(FROM, TO);
    const l = line(r, 'delivery');
    expect(l).toMatchObject({ revenueInr: '400.00', costInr: '90.00' });
    expect(l?.coverage).toMatchObject({ priced: 1, total: 2 });
    expect(l?.coverage.note).toMatch(/never got a waybill/);
    expect(r.complete).toBe(false);
    const rows = await drill(svc, 'delivery');
    expect(rows.items).toHaveLength(2);
    expect(rows.items.find((i) => i.ref === 'SD-2026-QA-338994')?.costInr).toBeNull();
    expect(rows.revenue).toBe('400.00');
  });

  it('two parcels on one order: charged once, their costs summed, a replaced one left out', async () => {
    const w = new World();
    w.order({
      events: [['DELIVERED', IN]],
      charges: [
        ['BASE_SHIPPING', '200'],
        ['GST', '36'],
      ],
      shipments: [{ fwd: '60' }, { fwd: '0', rto: '30' }, { fwd: '999', superseded: true }],
    });
    const svc = w.svc();
    const l = line(await svc.report(FROM, TO), 'delivery');
    const rows = await drill(svc, 'delivery');
    expect(l).toMatchObject({ revenueInr: '236.00', costInr: '90.00' });
    expect(l?.coverage).toMatchObject({ priced: 1, total: 1 });
    expect(rows.items).toHaveLength(1);
    expect(rows.items[0]).toMatchObject({ revenueInr: '236.00', costInr: '90.00' });
  });
});

describe('X7 — returns are the order’s fate too', () => {
  it('an rto_received EVENT puts it on returns, with or without shipments.rto_received_at', async () => {
    // SD-2026-QA-498051: rto_received on 29 Jul, no rto_received_at.
    const w = new World();
    w.order({
      number: 'SD-2026-QA-498051',
      events: [['RTO_RECEIVED', T('2026-07-29T10:00:00Z')]],
      charges: [
        ['BASE_SHIPPING', '200'],
        ['RTO_FEE', '30'],
      ],
      shipments: [{ rto: '140', rtoReceivedAt: null }],
    });
    const svc = w.svc();
    const july = line(await svc.report(T('2026-07-01T00:00:00Z'), FROM), 'rto');
    const august = line(await svc.report(FROM, TO), 'rto');
    expect(july).toMatchObject({ revenueInr: '230.00', costInr: '140.00' });
    expect(august).toMatchObject({ revenueInr: '0.00', costInr: '0.00' });
  });

  it('a stamp on the shipment WITHOUT the event does not put it on returns', async () => {
    const w = new World();
    w.order({
      events: [['RTO_IN_TRANSIT', IN]],
      charges: [['RTO_FEE', '30']],
      shipments: [{ rto: '140', rtoReceivedAt: IN }],
    });
    expect(line(await w.svc().report(FROM, TO), 'rto')?.revenueInr).toBe('0.00');
  });

  it('RTO_RESTOCKED counts when RTO_RECEIVED was skipped, dated by the restock', async () => {
    const w = new World();
    w.order({
      events: [['RTO_RESTOCKED', T('2026-08-12T00:00:00Z')]],
      charges: [['RTO_FEE', '30']],
      shipments: [{ rto: '100' }],
    });
    expect(line(await w.svc().report(FROM, TO), 'rto')?.costInr).toBe('100.00');
    const rows = await drill(w.svc(), 'rto');
    expect(rows.items[0]?.at).toBe('2026-08-12T00:00:00.000Z');
  });

  it('received then restocked is ONE return, dated by the receipt', async () => {
    const w = new World();
    w.order({
      events: [
        ['RTO_RECEIVED', T('2026-07-30T00:00:00Z')],
        ['RTO_RESTOCKED', T('2026-08-02T00:00:00Z')],
      ],
      charges: [['RTO_FEE', '30']],
      shipments: [{ rto: '100' }],
    });
    expect(line(await w.svc().report(FROM, TO), 'rto')?.revenueInr).toBe('0.00');
  });
});

describe('X8 — windows are half-open', () => {
  it('the first instant is in, the first instant of the next window is out, the last millisecond is in', async () => {
    const w = new World();
    w.freight('1', '0', FROM);
    w.freight('10', '0', T('2026-08-31T23:59:59.999Z'));
    w.freight('100', '0', TO);
    w.order({ events: [['DELIVERED', TO]], charges: [['BASE_SHIPPING', '1000']] });
    const r = await w.svc().report(FROM, TO);
    expect(line(r, 'inbound_freight')?.revenueInr).toBe('11.00');
    expect(line(r, 'delivery')?.revenueInr).toBe('0.00');
  });
});

describe('X9 — the rate is the latest recorded at or before the AMOUNT’s own instant', () => {
  it('a rate recorded at noon applies at 16:00, not at 09:00 the same day', async () => {
    const w = new World();
    w.rateHistory('1.20', T('2026-08-10T00:00:00Z'));
    w.rateHistory('1.32', T('2026-08-10T12:00:00Z'));
    w.bank({ type: 'EXPENSE', amount: '-1320', currency: 'BDT', at: T('2026-08-10T09:00:00Z') });
    w.bank({ type: 'EXPENSE', amount: '-1320', currency: 'BDT', at: T('2026-08-10T16:00:00Z') });
    // 1320/1.20 = 1100; 1320/1.32 = 1000.
    expect((await w.svc().report(FROM, TO)).operatingExpensesInr).toBe('2100.00');
  });

  it('counts DISTINCT amounts that fell back to today’s rate, however many lines converted them', async () => {
    const w = new World();
    w.todayRate('1.32');
    // One taka forwarder expense: operating expenses AND the unattributed
    // leg costs both convert it. It is one approximate figure, not two.
    w.bank({
      type: 'EXPENSE',
      amount: '-1320',
      currency: 'BDT',
      at: IN,
      expenseCategoryId: 'cat-fwd',
    });
    const r = await w.svc().report(FROM, TO);
    expect(r.warnings.find((x) => /today's rate/.test(x))).toMatch(/^1 amount\(s\)/);
  });
});

describe('X10 — an unattributed leg cost with no rate is NAMED, not silently dropped', () => {
  it('counts it, leaves it out of the ₹ figure, and says how many', async () => {
    const w = new World();
    w.bank({ type: 'EXPENSE', amount: '-2000', at: IN, expenseCategoryId: 'cat-fwd' });
    w.bank({
      type: 'EXPENSE',
      amount: '-1320',
      currency: 'BDT',
      at: IN,
      expenseCategoryId: 'cat-fwd',
    });
    const r = await w.svc().report(FROM, TO);
    expect(r.unattributedLegCosts).toMatchObject({
      amountInr: '2000.00',
      count: 2,
      unconverted: 1,
    });
    expect(r.unattributedLegCosts?.note).toMatch(
      /^1 of them had no exchange rate .* not in the ₹ figure/,
    );
  });
});

describe('X11 — a charge on a live parcel’s RETURN waybill is ours', () => {
  it('a customer-return pickup’s charges are not “no Skydrop parcel”; a voided parcel’s return still is', async () => {
    const w = new World();
    w.shipment({ awb: 'FWD-1', reverseAwb: 'REV-1' });
    w.shipment({ awb: 'FWD-2', reverseAwb: 'REV-2', deleted: true });
    w.txn({ kind: 'DEBIT', amount: '40', at: IN, category: 'PARCEL', awb: 'REV-1' });
    w.txn({ kind: 'DEBIT', amount: '15', at: IN, category: 'PARCEL', awb: 'REV-2' });
    const l = line(await w.svc().report(FROM, TO), 'courier_unmatched');
    expect(l?.costInr).toBe('15.00');
    expect(l?.basis.cost[0]).toMatchObject({ count: 1, amountInr: '15.00' });
  });
});

/**
 * A world with something on every line, on BOTH sides of the middle of
 * the month — including at exactly the middle instant.
 */
function richWorld(cutover: Date | null): World {
  const w = new World();
  if (cutover !== null) w.cutover(cutover);
  const d = (day: number, h = 6): Date =>
    T(`2026-08-${String(day).padStart(2, '0')}T${String(h).padStart(2, '0')}:00:00.000Z`);
  const MIDDLE = T('2026-08-16T00:00:00.000Z');

  // Opening balances first: they are their accounts' first capital entries.
  w.bank({ type: 'RECONCILIATION_ADJUSTMENT', amount: '100000', at: FROM });
  w.bank({ type: 'OWNER_CONTRIBUTION', amount: '1000', currency: 'BDT', at: T('2026-07-01Z') });
  w.rateHistory('1.32', T('2026-07-01T00:00:00Z'));
  w.rateHistory('1.30', MIDDLE);

  w.freight('1000', '600', FROM);
  w.freight('800', '500', MIDDLE, { status: 'WAIVED', amountSettledInr: D('300') });
  w.freight('999', null, d(20));
  w.freight('5', '1', TO);

  const orderA = w.order({
    events: [['DELIVERED', d(3)]],
    charges: [
      ['BASE_SHIPPING', '200'],
      ['GST', '36'],
    ],
    shipments: [{ awb: 'A-1', fwd: '90' }],
  });
  w.order({
    events: [['DELIVERED', MIDDLE]],
    charges: [['BASE_SHIPPING', '200']],
    refunds: ['50'],
    shipments: [{ fwd: '60' }, { fwd: '0', rto: '30' }],
  });
  // Lost: debited at booking, refunded on the loss — a lost parcel is not charged.
  w.order({
    events: [['LOST_IN_TRANSIT', d(20)]],
    charges: [['BASE_SHIPPING', '200']],
    refunds: ['200'],
    shipments: [{ fwd: '120' }],
  });
  w.order({
    events: [['DELIVERED', d(25)]],
    charges: [
      ['BASE_SHIPPING', '200'],
      // Debited with the rest and on no line until 2026-09-12.
      ['RESHIPMENT_FEE', '15'],
      ['ADJUSTMENT', '10'],
    ],
    shipments: [{ awb: null }],
  });
  // Called off after it left us: the fee kept, the courier's charge.
  w.order({
    events: [
      ['CONFIRMED', d(2)],
      ['DISPATCHED', d(4)],
      ['CANCELLED_BY_ADMIN', d(19)],
    ],
    debits: ['236'],
    shipments: [{ fwd: '77' }],
  });
  // Called off at exactly the middle, fee part-refunded, never waybilled.
  w.order({
    events: [['CANCELLED', MIDDLE]],
    debits: ['200'],
    refunds: ['50'],
    shipments: [{ awb: null }],
  });
  // Called off with nothing on it — a quote never billed: no row.
  w.order({ events: [['CANCELLED', d(8)]], charges: [['BASE_SHIPPING', '200']], billed: false });
  // Still in the warehouse, already charged for its waybill: the note only.
  w.order({ status: 'PICKED', shipments: [{ awb: 'SD-PICKED', fwd: '77.19' }] });
  w.order({
    events: [
      ['DELIVERED', d(5)],
      ['RTO_RECEIVED', d(22)],
    ],
    charges: [
      ['BASE_SHIPPING', '200'],
      ['RTO_FEE', '30'],
    ],
    refunds: ['30'],
    shipments: [{ fwd: '0', rto: '150', reverseAwb: 'REV-E' }],
  });
  w.order({
    events: [['RTO_RESTOCKED', d(12)]],
    charges: [
      ['BASE_SHIPPING', '200'],
      ['RTO_FEE', '30'],
    ],
    shipments: [{ rto: '100' }],
  });
  w.order({ events: [['DELIVERED', TO]], charges: [['BASE_SHIPPING', '777']] });
  w.order({ status: 'IN_TRANSIT', shipments: [{ fwd: '10' }] });
  void orderA;

  const tax = w.wallet('GST_WITHHOLDING', '152.54', d(3));
  w.wallet('GST_WITHHOLDING', '76.27', MIDDLE);
  w.wallet('COD_DEDUCTION_REFUND', '152.54', d(20), { linkedEntryId: tax['id'] });
  const fee = w.wallet('INSTANT_PAY_FEE', '50', d(4));
  w.wallet('COD_COLLECTION_FEE', '10', d(18));
  w.wallet('COD_DEDUCTION_REFUND', '21.19', d(19), { linkedEntryId: fee['id'] });
  w.wallet('SCRAP_REFUND', '1250', d(11));
  w.wallet('SCRAP_REFUND', '9', TO);

  const tr = w.transfer('10000', 'INR', '13000', 'BDT');
  w.bank({ type: 'FX_SPREAD', amount: '7.00', currency: 'BDT', at: d(6), transferId: tr });
  w.bank({ type: 'FX_SPREAD', amount: '-20', at: d(17) });
  w.bank({ type: 'FX_SPREAD', amount: '3', currency: 'BDT', at: d(18) }); // no transfer: history

  w.txn({ kind: 'DEBIT', amount: '58.83', at: d(2) });
  w.txn({ kind: 'CREDIT', amount: '1290', at: d(20) });
  w.txn({ kind: 'DEBIT', amount: '15', at: MIDDLE });
  w.txn({ kind: 'DEBIT', amount: '999', at: d(21), missing: true });
  w.txn({ kind: 'DEBIT', amount: '5', at: d(21), status: 'failed' });
  // A reconciliation on a Skydrop parcel (A-1): ours before the cutover too.
  w.txn({ kind: 'DEBIT', amount: '89.42', at: d(9), awb: 'A-1' });
  w.txn({ kind: 'CREDIT', amount: '88.24', at: d(10), awb: 'A-1' });

  w.shipment({ awb: 'DEAD-1', deleted: true });
  w.txn({ kind: 'DEBIT', amount: '48.36', at: d(3), category: 'PARCEL', awb: 'DEAD-1' });
  w.txn({ kind: 'CREDIT', amount: '10', at: d(18), category: 'PARCEL', awb: 'DEAD-1' });
  w.txn({ kind: 'DEBIT', amount: '11', at: d(4), category: 'PARCEL', awb: 'STRANGER' });
  w.txn({ kind: 'DEBIT', amount: '25', at: d(19), category: 'PARCEL', awb: 'STRANGER' });
  w.txn({ kind: 'DEBIT', amount: '90', at: d(4), category: 'PARCEL', awb: 'A-1' });
  w.txn({ kind: 'DEBIT', amount: '40', at: d(23), category: 'PARCEL', awb: 'REV-E' });

  w.bank({ type: 'EXPENSE', amount: '-90', at: d(9), settlementId: 'set-x' });
  w.bank({ type: 'EXPENSE', amount: '-45', at: MIDDLE, settlementId: 'set-y' });
  const early = w.settlement(d(7), ['50', '30'], { amount: '1000', allocated: '900' });
  w.settlement(d(23), ['-20']);
  // Typed as received in JULY, recorded on the 3rd: every figure it
  // produced is in August, together.
  w.settlement(T('2026-07-28T00:00:00.000Z'), ['40'], { recordedAt: d(3) });
  w.bank({
    type: 'EXPENSE',
    amount: '-30',
    at: T('2026-07-28T00:00:00.000Z'),
    recordedAt: d(3),
    settlementId: 'set-late',
  });
  // A line allocated later onto the payout of the 7th: recognised the 24th.
  w.settlementLine(early, '5', d(24));

  w.bank({ type: 'RECONCILIATION_ADJUSTMENT', amount: '-35.40', at: d(21) });
  w.bank({ type: 'RECONCILIATION_ADJUSTMENT', amount: '500', currency: 'BDT', at: d(14) });
  w.investment('100000', '101500', d(15));
  w.investment('50000', '51500', d(26), 'BDT');

  w.bank({ type: 'EXPENSE', amount: '-325', at: d(12), expenseCategoryId: 'cat-rent' });
  w.bank({
    type: 'EXPENSE',
    amount: '-1320',
    currency: 'BDT',
    at: d(13),
    expenseCategoryId: 'cat-fwd',
  });
  w.bank({ type: 'EXPENSE', amount: '-600', at: d(13), inboundFreightChargeId: 'ifc-x' });
  w.bank({ type: 'EXPENSE', amount: '-200', at: MIDDLE, expenseCategoryId: 'cat-rent' });
  return w;
}

const MID = T('2026-08-16T00:00:00.000Z');

describe('two adjacent windows add up to the window over both — every line', () => {
  it.each([
    ['with no cutover', null],
    ['with the cutover inside the second half', T('2026-08-18T00:00:00.000Z')],
  ])('%s', async (_label, cutover) => {
    const svc = richWorld(cutover).svc();
    const [a, b, whole] = await Promise.all([
      svc.report(FROM, MID),
      svc.report(MID, TO),
      svc.report(FROM, TO),
    ]);
    for (const key of PNL_LINE_KEYS) {
      const [la, lb, lw] = [line(a, key), line(b, key), line(whole, key)];
      expect({ key, revenue: total([la?.revenueInr ?? null, lb?.revenueInr ?? null]) }).toEqual({
        key,
        revenue: lw?.revenueInr,
      });
      expect({ key, cost: total([la?.costInr ?? null, lb?.costInr ?? null]) }).toEqual({
        key,
        cost: lw?.costInr,
      });
    }
    expect(total([a.operatingExpensesInr, b.operatingExpensesInr])).toBe(
      whole.operatingExpensesInr,
    );
    expect(total([a.grossMarginInr, b.grossMarginInr])).toBe(whole.grossMarginInr);
    expect(total([a.netInr, b.netInr])).toBe(whole.netInr);
    // And the world is not trivially empty.
    expect(whole.lines.filter((l) => l.revenueInr !== '0.00' || l.costInr !== '0.00')).toHaveLength(
      PNL_LINE_KEYS.length,
    );
  });
});

describe('every line’s rows add up to its total', () => {
  it.each([
    ['the whole month', FROM, TO],
    ['the first half', FROM, MID],
    ['the second half', MID, TO],
  ])('%s', async (_label, from, to) => {
    const svc = richWorld(T('2026-08-18T00:00:00.000Z')).svc();
    const r = await svc.report(from, to);
    for (const l of r.lines) {
      const rows = await drill(svc, l.key, from, to);
      expect({ key: l.key, revenue: rows.revenue, cost: rows.cost }).toEqual({
        key: l.key,
        revenue: l.revenueInr,
        cost: l.costInr,
      });
    }
  });

  it('an unknown line has no rows rather than a guess', async () => {
    const out = await richWorld(null).svc().lineItems('nope', FROM, TO);
    expect(out).toEqual({ key: 'nope', items: [], truncated: false });
  });

  it('worked numbers for the month, so the additivity above is not additivity of zeros', async () => {
    const r = await richWorld(null).svc().report(FROM, TO);
    // Delivered: A 236 (−90), B 200−50=150 (−90), D 200+15+10=225
    // (uncovered), lost C 200−200=0 (−120); called off: G 236 (−77), H 200−50=150
    // (no waybill, nothing to price). E is returned — returns only.
    expect(line(r, 'delivery')).toMatchObject({ revenueInr: '997.00', costInr: '377.00' });
    expect(line(r, 'delivery')?.coverage).toMatchObject({ priced: 5, total: 6 });
    expect(line(r, 'delivery')?.coverage.note).toMatch(
      /2 order\(s\) were called off.*1 order\(s\) first delivered in this window have since come back.*2 parcel\(s\) on orders not yet delivered.*₹87\.19/,
    );
    // 50 + 30 − 20, +40 recorded in August for July, +5 allocated later.
    expect(line(r, 'cod_shortfall')?.costInr).toBe('105.00');
    expect(line(r, 'cod_shortfall')?.coverage.note).toMatch(/1 payout\(s\).*₹100\.00 more/);
    expect(line(r, 'courier_cod_fees')?.costInr).toBe('165.00');
    // Returns: E 230−30=200 (−150), F 230 (−100).
    expect(line(r, 'rto')).toMatchObject({ revenueInr: '430.00', costInr: '250.00' });
    // ৳7 at 10000/13000 = 5.38; −20; ৳3 at 1/1.30 = 2.31.
    expect(line(r, 'fx')?.revenueInr).toBe('-12.31');
    // DEAD 38.36 + STRANGER 36; A-1 is live, REV-E is E's return waybill.
    expect(line(r, 'courier_unmatched')?.costInr).toBe('74.36');
    // + the A-1 reconciliation, net 1.18.
    expect(line(r, 'courier_adjustments')?.costInr).toBe('-1214.99');
    expect(line(r, 'inbound_freight')).toMatchObject({ revenueInr: '2299.00', costInr: '1100.00' });
  });
});

// ── The third audit (2026-09-12) ─────────────────────────────────────────

const JULY = T('2026-07-01T00:00:00.000Z');
const SEP_END = T('2026-10-01T00:00:00.000Z');

/** Two adjacent windows add up to the window over both, for the named lines. */
async function expectTiles(
  svc: PnlService,
  keys: readonly string[],
  a: Date,
  mid: Date,
  b: Date,
): Promise<void> {
  const [x, y, whole] = await Promise.all([
    svc.report(a, mid),
    svc.report(mid, b),
    svc.report(a, b),
  ]);
  for (const key of keys) {
    const [lx, ly, lw] = [line(x, key), line(y, key), line(whole, key)];
    expect({ key, revenue: total([lx?.revenueInr ?? null, ly?.revenueInr ?? null]) }).toEqual({
      key,
      revenue: lw?.revenueInr,
    });
    expect({ key, cost: total([lx?.costInr ?? null, ly?.costInr ?? null]) }).toEqual({
      key,
      cost: lw?.costInr,
    });
  }
  for (const [from, to, r] of [
    [a, mid, x],
    [mid, b, y],
    [a, b, whole],
  ] as const) {
    for (const key of keys) {
      const rows = await drill(svc, key, from, to);
      expect({ key, revenue: rows.revenue, cost: rows.cost }).toEqual({
        key,
        revenue: line(r, key)?.revenueInr,
        cost: line(r, key)?.costInr,
      });
    }
  }
}

describe('ONE payout, ONE date — everything it produced is dated when it was recorded', () => {
  const PAYOUT_LINES = ['cod_tax', 'cod_service_fees', 'cod_shortfall', 'courier_cod_fees'];

  it('typed as received in July, recorded in August: tax, fee, shortfall and early-COD fee are ALL in August', async () => {
    const w = new World();
    const received = T('2026-07-30T00:00:00.000Z');
    const recorded = T('2026-08-02T10:00:00.000Z');
    w.settlement(received, ['50'], { recordedAt: recorded });
    // The credit's deductions are written in the same transaction.
    w.wallet('GST_WITHHOLDING', '152.54', recorded);
    w.wallet('COD_COLLECTION_FEE', '10.00', recorded);
    w.bank({
      type: 'EXPENSE',
      amount: '-90',
      at: received,
      recordedAt: recorded,
      settlementId: 'set-z',
    });
    const svc = w.svc();
    const july = await svc.report(JULY, FROM);
    const aug = await svc.report(FROM, TO);
    for (const key of PAYOUT_LINES) {
      expect({ key, r: line(july, key)?.revenueInr, c: line(july, key)?.costInr }).toEqual({
        key,
        r: '0.00',
        c: '0.00',
      });
    }
    expect(line(aug, 'cod_tax')?.revenueInr).toBe('152.54');
    expect(line(aug, 'cod_service_fees')?.revenueInr).toBe('10.00');
    expect(line(aug, 'cod_shortfall')?.costInr).toBe('50.00');
    expect(line(aug, 'courier_cod_fees')?.costInr).toBe('90.00');
    const rows = await drill(svc, 'cod_shortfall');
    expect(rows.items[0]).toMatchObject({ at: recorded.toISOString(), costInr: '50.00' });
    expect(rows.items[0]?.subRef).toMatch(/received 30 Jul 2026/);
    expect((await drill(svc, 'courier_cod_fees')).items[0]?.at).toBe(recorded.toISOString());
    await expectTiles(svc, PAYOUT_LINES, JULY, FROM, TO);
  });

  it('a line allocated LATER is recognised when it was added, not in the month the payout names', async () => {
    const w = new World();
    const sid = w.settlement(T('2026-07-15T00:00:00.000Z'), ['20']);
    w.settlementLine(sid, '35', T('2026-08-20T00:00:00.000Z'));
    const svc = w.svc();
    expect(line(await svc.report(JULY, FROM), 'cod_shortfall')?.costInr).toBe('20.00');
    expect(line(await svc.report(FROM, TO), 'cod_shortfall')?.costInr).toBe('35.00');
    await expectTiles(svc, ['cod_shortfall'], JULY, FROM, TO);
  });
});

describe('a courier OVERPAYMENT is named, never counted', () => {
  it('a payout that brought in more than it was allocated to is in the shortfall note, not in any figure', async () => {
    const w = new World();
    w.settlement(IN, [], { amount: '1000', allocated: '900' });
    // Fully explained: ₹950 landed + ₹50 early-COD fee = ₹1,000 allocated.
    w.settlement(IN, [], { amount: '950', allocated: '1000', earlyFee: '50' });
    const svc = w.svc();
    const r = await svc.report(FROM, TO);
    const l = line(r, 'cod_shortfall');
    expect(l).toMatchObject({ revenueInr: '0.00', costInr: '0.00' });
    expect(l?.coverage.note).toMatch(
      /1 payout\(s\) recorded in this window brought in ₹100\.00 more than they were allocated/,
    );
    expect(l?.coverage.note).toMatch(/not income/);
    expect(r.grossMarginInr).toBe('0.00');
    expect(line(await svc.report(JULY, FROM), 'cod_shortfall')?.coverage.note).toBeNull();
  });
});

describe('an order CALLED OFF with money on it is on the delivery line, dated by the cancellation', () => {
  it('a fee kept on a cancel after dispatch, with the courier cost of the parcel that had left us', async () => {
    const w = new World();
    w.order({
      number: 'SD-OFF-1',
      events: [
        ['CONFIRMED', T('2026-07-20T00:00:00.000Z')],
        ['DISPATCHED', T('2026-07-25T00:00:00.000Z')],
        ['CANCELLED_BY_ADMIN', IN],
      ],
      charges: [
        ['BASE_SHIPPING', '200'],
        ['GST', '36'],
      ],
      debits: ['236'],
      shipments: [{ awb: 'LEFT-1', fwd: '77.19' }],
    });
    const svc = w.svc();
    const l = line(await svc.report(FROM, TO), 'delivery');
    expect(l).toMatchObject({ revenueInr: '236.00', costInr: '77.19' });
    expect(l?.coverage).toMatchObject({ priced: 1, total: 1 });
    expect(l?.basis.revenue.find((p) => p.label.startsWith('Delivery fee taken'))).toMatchObject({
      count: 1,
      amountInr: '236.00',
    });
    expect(l?.basis.cost.find((p) => /called off/.test(p.label))?.amountInr).toBe('77.19');
    expect(l?.coverage.note).toMatch(/1 order\(s\) were called off/);
    const rows = await drill(svc, 'delivery');
    expect(rows.items).toEqual([
      expect.objectContaining({ ref: 'SD-OFF-1', revenueInr: '236.00', costInr: '77.19' }),
    ]);
    expect(rows.items[0]?.subRef).toContain('called off (cancelled_by_admin)');
    // Dispatched in July; its fate — the cancellation — is August's.
    expect(line(await svc.report(JULY, FROM), 'delivery')?.revenueInr).toBe('0.00');
  });

  it('cancelled before it left: the refunded fee nets to nothing, and the voided parcel’s charge stays on the no-live-parcel line', async () => {
    const w = new World();
    w.order({
      events: [
        ['CONFIRMED', IN],
        ['CANCELLED', IN],
      ],
      debits: ['236'],
      refunds: ['236'],
      shipments: [{ awb: 'VOID-1', deleted: true, fwd: '77.19' }],
    });
    w.txn({ kind: 'DEBIT', amount: '77.19', at: IN, category: 'PARCEL', awb: 'VOID-1' });
    const r = await w.svc().report(FROM, TO);
    expect(line(r, 'delivery')).toMatchObject({ revenueInr: '0.00', costInr: '0.00' });
    expect(line(r, 'delivery')?.coverage.total).toBe(0);
    expect(line(r, 'courier_unmatched')?.costInr).toBe('77.19');
  });

  it('a cancelled order with no money on it — a quote never billed, no waybill — is no row at all', async () => {
    const w = new World();
    w.order({
      events: [['CANCELLED', IN]],
      charges: [['BASE_SHIPPING', '200']],
      billed: false,
      shipments: [{ awb: null }],
    });
    const svc = w.svc();
    expect(line(await svc.report(FROM, TO), 'delivery')?.coverage.total).toBe(0);
    expect((await drill(svc, 'delivery')).items).toHaveLength(0);
  });

  it('a rejection reopened and rejected again is counted ONCE, at the final rejection — and windows tile', async () => {
    const w = new World();
    w.order({
      events: [
        ['REJECTED_BY_CUSTOMER', T('2026-08-03T00:00:00.000Z')],
        ['PENDING_CONFIRMATION', T('2026-08-04T00:00:00.000Z')],
        ['REJECTED_BY_CUSTOMER', T('2026-08-20T00:00:00.000Z')],
      ],
      debits: ['50'],
    });
    const svc = w.svc();
    expect(line(await svc.report(FROM, MID), 'delivery')?.revenueInr).toBe('0.00');
    expect(line(await svc.report(MID, TO), 'delivery')?.revenueInr).toBe('50.00');
    await expectTiles(svc, ['delivery'], FROM, MID, TO);
  });

  it('a delivered order god-moded to cancelled is counted as CALLED OFF, dated by the cancellation — never twice', async () => {
    // Its CURRENT fate decides: cancelled. Revenue is what it was billed
    // either way, so moving parts of the delivery line changes no figure.
    const w = new World();
    w.order({
      events: [
        ['DELIVERED', T('2026-07-20T00:00:00.000Z')],
        ['CANCELLED_BY_ADMIN', T('2026-08-20T00:00:00.000Z')],
      ],
      charges: [['BASE_SHIPPING', '200']],
      shipments: [{ fwd: '90' }],
    });
    const svc = w.svc();
    const aug = line(await svc.report(FROM, TO), 'delivery');
    expect(aug).toMatchObject({ revenueInr: '200.00', costInr: '90.00' });
    expect(aug?.coverage.total).toBe(1);
    const rows = await drill(svc, 'delivery');
    expect(rows.items[0]?.subRef).toContain('called off (cancelled_by_admin)');
    expect(rows.items[0]?.at).toBe('2026-08-20T00:00:00.000Z');
    // July, when it was delivered, no longer counts it — and says so.
    const july = line(await svc.report(JULY, FROM), 'delivery');
    expect(july).toMatchObject({ revenueInr: '0.00', costInr: '0.00' });
    expect(july?.coverage.note).toMatch(
      /1 order\(s\) delivered or lost in this window have since left that fate/,
    );
    await expectTiles(svc, ['delivery', 'rto'], JULY, FROM, TO);
  });
});

describe('orderFate — every status is on exactly one line, or deliberately on none', () => {
  it('every TERMINAL status has a known fate, and no status left open is terminal', () => {
    const sm = new OrderStateMachineService();
    const all = Object.values(OrderStatus);
    const terminalButOpen = all.filter((s) => sm.isTerminal(s) && orderFate(s) === 'open');
    expect(terminalButOpen).toEqual([]);
    // Settled, though the machine still has an edge out of them: a
    // delivered order can come back, a received one is restocked or
    // written off, and a rejection can be reopened by an approved request.
    const settledNotTerminal = all
      .filter((s) => orderFate(s) !== 'open' && !sm.isTerminal(s))
      .sort();
    expect(settledNotTerminal).toEqual(
      [
        OrderStatus.DELIVERED,
        OrderStatus.REJECTED_BY_CUSTOMER,
        OrderStatus.REJECTED_NDR,
        OrderStatus.RTO_RECEIVED,
      ].sort(),
    );
  });
});

describe('an order whose fate is not known is on no line — and the note says what it already cost', () => {
  it('counts every parcel with a waybill on an open order, in the warehouse too, and the courier cost on them', async () => {
    const w = new World();
    // SD-2026-26-000004: PICKED, ₹77.19 debited when its waybill was booked.
    w.order({ status: 'PICKED', shipments: [{ awb: 'SD-4', fwd: '77.19' }] });
    w.order({ status: 'CONFIRMED', shipments: [{ awb: 'SD-5' }] });
    w.order({ status: 'IN_TRANSIT', shipments: [{ fwd: '30' }] });
    // Neither of these is open: one is on the line, one was voided.
    w.order({ events: [['DELIVERED', IN]], shipments: [{ fwd: '90' }] });
    w.order({ status: 'PENDING_PICK', shipments: [{ awb: 'SD-6', fwd: '5', deleted: true }] });
    const l = line(await w.svc().report(FROM, TO), 'delivery');
    expect(l).toMatchObject({ costInr: '90.00' });
    expect(l?.coverage.note).toMatch(
      /3 parcel\(s\) on orders not yet delivered, returned or called off hold a waybill and 2 already carry ₹107\.19 of courier cost/,
    );
  });
});

describe('every charge the seller is debited is revenue on some line', () => {
  it('delivery is every charge type but the return fee and a REFUND line; returns add the return fee', () => {
    const all = Object.values(ChargeType);
    expect([...DELIVERY_REVENUE_TYPES].sort()).toEqual(
      all.filter((t) => t !== ChargeType.RTO_FEE && t !== ChargeType.REFUND).sort(),
    );
    expect([...RETURN_REVENUE_TYPES].sort()).toEqual(
      all.filter((t) => t !== ChargeType.REFUND).sort(),
    );
  });

  it('a reshipment fee, an adjustment and an "other" line are billed revenue, through the debit that billed them — in the total and its rows', async () => {
    const w = new World();
    w.order({
      events: [['DELIVERED', IN]],
      charges: [
        ['BASE_SHIPPING', '200'],
        ['RESHIPMENT_FEE', '50'],
        ['ADJUSTMENT', '-10'],
        ['OTHER', '5'],
        ['REFUND', '20'],
      ],
      shipments: [{ fwd: '90' }],
    });
    w.order({
      events: [['RTO_RECEIVED', IN]],
      charges: [
        ['BASE_SHIPPING', '200'],
        ['RESHIPMENT_FEE', '50'],
        ['RTO_FEE', '30'],
        ['REFUND', '99'],
      ],
      shipments: [{ rto: '100' }],
    });
    const svc = w.svc();
    const r = await svc.report(FROM, TO);
    expect(line(r, 'delivery')?.revenueInr).toBe('245.00');
    expect(line(r, 'rto')?.revenueInr).toBe('280.00');
    // By wallet direction: the ORDER_CHARGES debit is every line but the
    // return fee and a REFUND line (the accrual's own sum).
    expect(line(r, 'delivery')?.basis.revenue.map((p) => [p.label, p.amountInr])).toEqual([
      ['Delivery fees debited to sellers', '245.00'],
    ]);
    expect(line(r, 'rto')?.basis.revenue.map((p) => [p.label, p.amountInr])).toEqual([
      ['Delivery fees debited on returned parcels', '250.00'],
      ['Return fees debited', '30.00'],
    ]);
    expect(line(r, 'delivery')?.coverage.note ?? '').not.toMatch(/never debited/);
    expect((await drill(svc, 'delivery')).revenue).toBe('245.00');
    expect((await drill(svc, 'rto')).revenue).toBe('280.00');
  });
});

describe('a restatement is SAID — and windows still tile', () => {
  it('delivered in August and back in September; lost in August and found in September', async () => {
    const w = new World();
    w.order({
      events: [
        ['DELIVERED', T('2026-08-05T00:00:00.000Z')],
        ['RTO_RECEIVED', T('2026-09-10T00:00:00.000Z')],
      ],
      charges: [
        ['BASE_SHIPPING', '200'],
        ['RTO_FEE', '30'],
      ],
      shipments: [{ fwd: '0', rto: '150' }],
    });
    w.order({
      events: [
        ['LOST_IN_TRANSIT', T('2026-08-03T00:00:00.000Z')],
        ['DELIVERED', T('2026-09-09T00:00:00.000Z')],
      ],
      charges: [['BASE_SHIPPING', '200']],
      shipments: [{ fwd: '90' }],
    });
    const svc = w.svc();
    const aug = await svc.report(FROM, TO);
    const sep = await svc.report(TO, SEP_END);
    // Found: dated by the loss, so August carries it. Returned: on
    // September's returns, not August's delivery.
    expect(line(aug, 'delivery')).toMatchObject({ revenueInr: '200.00', costInr: '90.00' });
    expect(line(aug, 'delivery')?.coverage.note).toMatch(
      /1 order\(s\) first delivered in this window have since come back/,
    );
    expect(line(aug, 'delivery')?.coverage.note).toMatch(
      /1 order\(s\) were lost in transit in this window and later found and delivered/,
    );
    expect(line(sep, 'delivery')?.revenueInr).toBe('0.00');
    expect(line(sep, 'rto')).toMatchObject({ revenueInr: '230.00', costInr: '150.00' });
    expect(line(sep, 'rto')?.coverage.note).toMatch(/1 of these had been delivered first/);
    await expectTiles(svc, ['delivery', 'rto'], FROM, TO, SEP_END);
  });
});

describe('an adjustment on a SKYDROP parcel counts whatever the cutover', () => {
  it('Monthly Recon on 38061110523994 (₹89.42 − ₹88.24 = ₹1.18) is on the line; a stranger’s stays out and is named', async () => {
    const w = new World().cutover(CUTOVER);
    w.shipment({ awb: '38061110523994' });
    w.shipment({ awb: 'DEAD-ADJ', deleted: true });
    w.shipment({ awb: 'FWD-9', reverseAwb: 'REV-9' });
    w.shipment({ awb: 'SR-ONLY', courierCode: 'shiprocket' });
    w.shipment({ awb: 'NEW', courierCode: 'shiprocket', courierOrderId: 'SR-1' });
    const late = T('2026-08-31T20:00:00.000Z');
    w.txn({ kind: 'DEBIT', amount: '89.42', at: late, awb: '38061110523994' });
    w.txn({ kind: 'CREDIT', amount: '88.24', at: late, awb: '38061110523994' });
    w.txn({ kind: 'DEBIT', amount: '12.00', at: IN, awb: 'DEAD-ADJ' }); // voided: ours
    w.txn({ kind: 'DEBIT', amount: '3.00', at: IN, awb: 'REV-9' }); // its return waybill: ours
    // Shiprocket replaced the waybill; the ORDER id is still ours.
    w.txn({ kind: 'DEBIT', amount: '7.00', at: IN, awb: 'OLD', ref: 'SR-1', account: 'ca-sr' });
    // Another courier's parcel on this account's waybill: not ours.
    w.txn({ kind: 'DEBIT', amount: '500.00', at: IN, awb: 'SR-ONLY' });
    w.txn({ kind: 'CREDIT', amount: '1290.00', at: IN, awb: 'STRANGER' });
    const svc = w.svc();
    const l = line(await svc.report(FROM, TO), 'courier_adjustments');
    expect(l?.costInr).toBe('23.18');
    expect(l?.coverage.note).toMatch(
      /2 adjustment\(s\) dated before 1 Oct 2026 \(net credit ₹790\.00\) are not counted/,
    );
    expect(l?.coverage.note).toMatch(
      /5 adjustment\(s\) dated before 1 Oct 2026 \(net ₹23\.18\) name a Skydrop parcel and ARE counted/,
    );
    const rows = await drill(svc, 'courier_adjustments');
    expect(rows.items).toHaveLength(5);
    expect(rows.items.every((i) => i.subRef?.includes('Skydrop parcel') === true)).toBe(true);
    await expectTiles(svc, ['courier_adjustments'], FROM, MID, TO);
  });
});

// ── The fourth review (2026-09-12) ───────────────────────────────────────

describe('every status orderFate settles is selected by its line', () => {
  it('an order forced straight to ANY delivered, returned or called-off status is on that line', async () => {
    const lineOf = { delivered: 'delivery', called_off: 'delivery', returned: 'rto' } as const;
    const settled = Object.values(OrderStatus).filter((s) => orderFate(s) !== 'open');
    // RTO_DAMAGED was a returned fate the returns line did not select.
    expect(settled).toContain(OrderStatus.RTO_DAMAGED);
    for (const status of settled) {
      const w = new World();
      w.order({
        number: status,
        events: [[status, IN]],
        debits: ['10'],
        shipments: [{ fwd: '1' }],
      });
      const fate = orderFate(status);
      if (fate === 'open') continue;
      const rows = await drill(w.svc(), lineOf[fate]);
      expect({ status, refs: rows.items.map((i) => i.ref) }).toEqual({ status, refs: [status] });
    }
  });
});

describe('revenue is what was BILLED, not what was quoted', () => {
  it('a charge line added after the debit is not revenue — named in the note and on the row', async () => {
    const w = new World();
    w.order({
      number: 'SD-LATE-LINE',
      events: [['DELIVERED', IN]],
      charges: [
        ['BASE_SHIPPING', '200'],
        ['ADJUSTMENT', '50'],
      ],
      debits: ['200'],
      shipments: [{ fwd: '90' }],
    });
    const svc = w.svc();
    const l = line(await svc.report(FROM, TO), 'delivery');
    expect(l).toMatchObject({ revenueInr: '200.00', costInr: '90.00' });
    expect(l?.coverage.note).toMatch(
      /1 order\(s\) carry ₹50\.00 of charge lines that were never debited to the seller/,
    );
    const rows = await drill(svc, 'delivery');
    expect(rows.revenue).toBe('200.00');
    expect(rows.items[0]?.subRef).toContain('₹50.00 quoted, never billed');
  });

  it('a customer return earns the customer-return fee it was debited, beside its delivery fee', async () => {
    const w = new World();
    const id = w.order({
      events: [
        ['DELIVERED', T('2026-08-02T00:00:00.000Z')],
        ['RTO_INITIATED', T('2026-08-05T00:00:00.000Z')],
        ['RTO_RECEIVED', IN],
      ],
      charges: [
        ['BASE_SHIPPING', '200'],
        ['RTO_FEE', '200'],
      ],
      billed: false,
      debits: ['200'],
      shipments: [{ fwd: '0', rto: '150' }],
    });
    w.wallet('CUSTOMER_RETURN_FEE', '200', IN, { linkedOrderId: id });
    const svc = w.svc();
    const l = line(await svc.report(FROM, TO), 'rto');
    expect(l).toMatchObject({ revenueInr: '400.00', costInr: '150.00' });
    expect(l?.basis.revenue.map((p) => [p.label, p.amountInr])).toEqual([
      ['Delivery fees debited on returned parcels', '200.00'],
      ['Customer-return fees debited', '200.00'],
    ]);
    expect(l?.coverage.note ?? '').not.toMatch(/never debited/);
    expect((await drill(svc, 'rto')).revenue).toBe('400.00');
    await expectTiles(svc, ['delivery', 'rto'], JULY, FROM, TO);
  });
});

describe('the no-live-parcel line agrees with where the importer nets a charge', () => {
  it('a waybill a VOIDED shipment holds is that shipment’s, even when a live one shares its order id', async () => {
    const w = new World();
    // Shiprocket order R-1: the first booking voided, a live one after it.
    w.shipment({ awb: 'X-VOID', courierOrderId: 'R-1', courierCode: 'shiprocket', deleted: true });
    w.shipment({ awb: 'X-LIVE', courierOrderId: 'R-1', courierCode: 'shiprocket' });
    // Held by the voided shipment: the importer stamps it there, which no
    // cohort reads, so it belongs HERE — not excused by X-LIVE.
    w.txn({
      kind: 'DEBIT',
      amount: '40',
      at: IN,
      category: 'PARCEL',
      awb: 'X-VOID',
      ref: 'R-1',
      account: 'ca-sr',
    });
    // Held by nobody, filed under R-1: an alias, netted onto the live one.
    w.txn({
      kind: 'DEBIT',
      amount: '5',
      at: IN,
      category: 'PARCEL',
      awb: 'X-ALIAS',
      ref: 'R-1',
      account: 'ca-sr',
    });
    // Held by another courier's shipment: never netted as an alias —
    // nobody's here, whatever its order id says.
    w.shipment({ awb: 'TAKEN', courierCode: 'delhivery' });
    w.txn({
      kind: 'DEBIT',
      amount: '7',
      at: IN,
      category: 'PARCEL',
      awb: 'TAKEN',
      ref: 'R-1',
      account: 'ca-sr',
    });
    const svc = w.svc();
    const l = line(await svc.report(FROM, TO), 'courier_unmatched');
    expect(l?.costInr).toBe('47.00');
    expect(l?.basis.cost.map((p) => [p.count, p.amountInr])).toEqual([
      [1, '40.00'],
      [1, '7.00'],
    ]);
    const rows = await drill(svc, 'courier_unmatched');
    expect(rows.items.map((i) => i.ref).sort()).toEqual(['TAKEN', 'X-VOID']);
    expect(rows.cost).toBe('47.00');
  });
});

describe('a freight bill priced at TODAY’s rate is said to be', () => {
  it('warns, and the report is not complete, when a forwarder payment had no rate recorded before it', async () => {
    const w = new World();
    const bill = w.freight('2000', '1626.02', IN);
    w.bank({
      type: 'EXPENSE',
      amount: '-2000',
      currency: 'BDT',
      at: IN,
      inboundFreightChargeId: bill,
    });
    w.todayRate('1.23');
    const r = await w.svc().report(FROM, TO);
    expect(r.warnings).toEqual([
      expect.stringMatching(/^1 forwarder payment\(s\) on freight bills.*today's rate/),
    ]);
    expect(r.complete).toBe(false);
  });

  it('says nothing when a rate was recorded at or before the payment — or the bill is another window’s', async () => {
    const w = new World();
    const bill = w.freight('2000', '1626.02', IN);
    w.bank({
      type: 'EXPENSE',
      amount: '-2000',
      currency: 'BDT',
      at: IN,
      inboundFreightChargeId: bill,
    });
    w.rateHistory('1.23', T('2026-08-01T00:00:00.000Z'));
    const r = await w.svc().report(FROM, TO);
    expect(r.warnings).toEqual([]);
    expect(r.complete).toBe(true);

    const other = new World();
    const july = other.freight('2000', '1626.02', T('2026-07-15T00:00:00.000Z'));
    other.bank({
      type: 'EXPENSE',
      amount: '-2000',
      currency: 'BDT',
      at: IN,
      inboundFreightChargeId: july,
    });
    other.todayRate('1.23');
    expect((await other.svc().report(FROM, TO)).warnings).toEqual([]);
  });
});

describe('a cohort counts an order only in the fate it is in NOW', () => {
  it('delivered by mistake, corrected, delivered for real: counted once, at the REAL delivery — and July says it moved', async () => {
    const w = new World();
    w.order({
      number: 'SD-CORRECTED',
      events: [
        ['DELIVERED', T('2026-07-20T00:00:00.000Z')],
        ['IN_TRANSIT', T('2026-07-21T00:00:00.000Z')],
        ['DELIVERED', IN],
      ],
      charges: [['BASE_SHIPPING', '200']],
      shipments: [{ fwd: '90' }],
    });
    const svc = w.svc();
    const july = line(await svc.report(JULY, FROM), 'delivery');
    expect(july).toMatchObject({ revenueInr: '0.00', costInr: '0.00' });
    expect(july?.coverage.note).toMatch(
      /1 order\(s\) delivered or lost in this window have since left that fate/,
    );
    expect(line(await svc.report(FROM, TO), 'delivery')).toMatchObject({
      revenueInr: '200.00',
      costInr: '90.00',
    });
    expect((await drill(svc, 'delivery')).items[0]?.at).toBe(IN.toISOString());
    await expectTiles(svc, ['delivery', 'rto'], JULY, FROM, TO);
  });

  it('delivered by mistake and corrected back: on NO line, and counted with the parcels still moving', async () => {
    const w = new World();
    w.order({
      events: [
        ['DELIVERED', T('2026-08-05T00:00:00.000Z')],
        ['IN_TRANSIT', T('2026-08-06T00:00:00.000Z')],
      ],
      charges: [['BASE_SHIPPING', '200']],
      shipments: [{ fwd: '90' }],
    });
    const l = line(await w.svc().report(FROM, TO), 'delivery');
    expect(l).toMatchObject({ revenueInr: '0.00', costInr: '0.00' });
    expect(l?.coverage.total).toBe(0);
    expect(l?.coverage.note).toMatch(
      /At the end of this window 1 parcel\(s\) on orders not yet delivered/,
    );
  });

  it('a customer return still on its way back stays on delivery until it is received', async () => {
    const w = new World();
    w.order({
      events: [
        ['DELIVERED', T('2026-08-03T00:00:00.000Z')],
        ['RTO_INITIATED', T('2026-08-10T00:00:00.000Z')],
      ],
      charges: [['BASE_SHIPPING', '200']],
      shipments: [{ fwd: '90' }],
    });
    const l = line(await w.svc().report(FROM, TO), 'delivery');
    expect(l).toMatchObject({ revenueInr: '200.00', costInr: '90.00' });
    expect(l?.coverage.note ?? '').not.toMatch(/not yet delivered/);
  });
});

describe('a customer return LOST on its way back is labelled as one', () => {
  it('delivered, then lost on the return leg: billed as delivered, dated by the delivery — not "lost, then found"', async () => {
    const w = new World();
    w.order({
      events: [
        ['DELIVERED', T('2026-08-03T00:00:00.000Z')],
        ['RTO_INITIATED', T('2026-08-10T00:00:00.000Z')],
        ['RTO_IN_TRANSIT', T('2026-08-11T00:00:00.000Z')],
        ['LOST_IN_TRANSIT', T('2026-08-15T00:00:00.000Z')],
      ],
      charges: [['BASE_SHIPPING', '200']],
      shipments: [{ fwd: '60', rto: '40' }],
    });
    const svc = w.svc();
    const l = line(await svc.report(FROM, TO), 'delivery');
    expect(l).toMatchObject({ revenueInr: '200.00', costInr: '100.00' });
    expect(l?.coverage.note).toMatch(
      /1 order\(s\) were delivered and then lost on their way back \(a customer return lost in transit\)/,
    );
    expect(l?.coverage.note).not.toMatch(/later found and delivered/);
    expect(l?.coverage.note).not.toMatch(/parcel\(s\) were lost in transit/);
    const rows = await drill(svc, 'delivery');
    expect(rows.items[0]?.at).toBe('2026-08-03T00:00:00.000Z');
    expect(rows.items[0]?.subRef).toContain('delivered, then lost on its way back');
  });
});

describe('parcels still moving are counted as of the END of the window', () => {
  it('a past month counts what was still moving then — not what is moving now', async () => {
    const w = new World();
    // In transit at the end of August, delivered on 5 Sep.
    w.order({
      events: [
        ['DISPATCHED', T('2026-08-20T00:00:00.000Z')],
        ['DELIVERED', T('2026-09-05T00:00:00.000Z')],
      ],
      charges: [['BASE_SHIPPING', '200']],
      shipments: [{ awb: 'MOVING-IN-AUG', fwd: '50', createdAt: T('2026-08-20T00:00:00.000Z') }],
    });
    // Booked on 2 Sep and still moving now: not August's.
    w.order({
      status: 'IN_TRANSIT',
      shipments: [{ awb: 'BOOKED-IN-SEP', createdAt: T('2026-09-02T00:00:00.000Z') }],
    });
    // Voided on 10 Aug: not moving at the end of August.
    w.order({ status: 'PENDING_PICK', shipments: [{ awb: 'VOIDED', deleted: true }] });
    const svc = w.svc();
    const aug = line(await svc.report(FROM, TO), 'delivery');
    expect(aug?.coverage.note).toMatch(
      /At the end of this window 1 parcel\(s\) on orders not yet delivered, returned or called off hold a waybill and 1 already carry ₹50\.00 of courier cost/,
    );
    const sep = line(await svc.report(TO, SEP_END), 'delivery');
    expect(sep).toMatchObject({ revenueInr: '200.00', costInr: '50.00' });
    expect(sep?.coverage.note).toMatch(
      /At the end of this window 1 parcel\(s\) on orders not yet delivered, returned or called off hold a waybill\. They are on no line/,
    );
  });
});
