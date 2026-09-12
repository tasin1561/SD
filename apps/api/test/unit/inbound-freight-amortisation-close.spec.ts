import { InboundFreightMode, InboundFreightStatus, Prisma } from '@skydrop/db';
import { InboundFreightAmortisationService } from '../../src/modules/inbound-freight/services/inbound-freight-amortisation.service';
import type { PrismaService } from '../../src/infrastructure/prisma/prisma.service';
import type { CatalogReadService } from '../../src/modules/catalog-read/services/catalog-read.service';
import type { WalletService } from '../../src/modules/seller-wallet/services/wallet.service';

/**
 * A pay-later bill must collect EXACTLY its total over its life.
 *
 * These run the real amortisation over a STATEFUL in-memory bill and its
 * lines — the mocked suite beside this one answers every update the same
 * way, which is precisely why it could not see a bill close short: the
 * shortfall only exists across two charges, once the counters have moved.
 */

type Args = Record<string, unknown>;
const D = (v: string): Prisma.Decimal => new Prisma.Decimal(v);

interface Line {
  id: string;
  batchId: string;
  units: number;
  unitsSettled: number;
  lineTotalInr: Prisma.Decimal;
  lineGrossInr: Prisma.Decimal;
  amountSettledInr: Prisma.Decimal;
}

interface Bill {
  id: string;
  mode: InboundFreightMode;
  status: InboundFreightStatus;
  totalInr: Prisma.Decimal;
  amountSettledInr: Prisma.Decimal;
  unitsSettled: number;
  totalUnits: number;
}

/** A Prisma write value: a plain value, or `{ increment }`. */
function applyDecimal(current: Prisma.Decimal, v: unknown): Prisma.Decimal {
  if (v !== null && typeof v === 'object' && 'increment' in v) {
    return current.add((v as { increment: Prisma.Decimal }).increment);
  }
  return new Prisma.Decimal(v as Prisma.Decimal);
}

function world(bill: Bill, lines: Line[]) {
  const debits: Array<{ orderId: string; amount: Prisma.Decimal }> = [];
  let items: Array<{ id: string; quantity: number; pickedBatchId: string }> = [];
  const lineById = (id: unknown): Line => {
    const l = lines.find((x) => x.id === id);
    if (l === undefined) throw new Error(`no line ${String(id)}`);
    return l;
  };

  const client = {
    $executeRaw: jest.fn(async () => 1),
    sellerWalletEntry: {
      findFirst: jest.fn(async (a: Args) => {
        const orderId = (a['where'] as Args)['linkedOrderId'];
        return debits.some((d) => d.orderId === orderId) ? { id: 'we-old' } : null;
      }),
    },
    shipmentItem: { findMany: jest.fn(async () => items) },
    stockBatch: {
      findUnique: jest.fn(async (a: Args) => ({
        id: (a['where'] as Args)['id'],
        parentBatchId: null,
      })),
    },
    goodsReceiptLine: {
      findFirst: jest.fn(async (a: Args) => {
        const l = lines.find((x) => x.batchId === (a['where'] as Args)['batchId']);
        if (l === undefined) return null;
        return {
          freightAllocation: {
            id: l.id,
            freightChargeId: bill.id,
            perUnitInr: l.lineGrossInr.div(l.units),
            units: l.units,
            unitsSettled: l.unitsSettled,
            lineTotalInr: l.lineTotalInr,
            lineGrossInr: l.lineGrossInr,
            amountSettledInr: l.amountSettledInr,
            freightCharge: { mode: bill.mode, status: bill.status },
          },
        };
      }),
    },
    inboundFreightAllocation: {
      update: jest.fn(async (a: Args) => {
        const l = lineById((a['where'] as Args)['id']);
        const data = a['data'] as Args;
        if (typeof data['unitsSettled'] === 'number') l.unitsSettled = data['unitsSettled'];
        if (data['amountSettledInr'] !== undefined) {
          l.amountSettledInr = applyDecimal(l.amountSettledInr, data['amountSettledInr']);
        }
        return { ...l };
      }),
      findMany: jest.fn(async () =>
        lines.map((l) => ({ id: l.id, units: l.units, lineGrossInr: l.lineGrossInr })),
      ),
    },
    inboundFreightCharge: {
      findUnique: jest.fn(async () => ({ ...bill })),
      update: jest.fn(async (a: Args) => {
        const data = a['data'] as Args;
        const units = data['unitsSettled'];
        if (units !== null && typeof units === 'object' && 'increment' in units) {
          bill.unitsSettled += (units as { increment: number }).increment;
        }
        if (data['amountSettledInr'] !== undefined) {
          bill.amountSettledInr = applyDecimal(bill.amountSettledInr, data['amountSettledInr']);
        }
        if (data['status'] !== undefined) bill.status = data['status'] as InboundFreightStatus;
        return { ...bill };
      }),
    },
  };

  const wallet = {
    applyEntry: jest.fn(async (_tx: unknown, e: Args) => {
      debits.push({ orderId: e['linkedOrderId'] as string, amount: e['amount'] as Prisma.Decimal });
      return { id: `we-${debits.length}`, runningBalanceAfter: D('0') };
    }),
  } as unknown as WalletService;

  const svc = new InboundFreightAmortisationService(
    { client } as unknown as PrismaService,
    {} as CatalogReadService,
    wallet,
  );

  return {
    bill,
    lines,
    debits,
    collectedNow: (): string => debits.reduce((s, d) => s.add(d.amount), D('0')).toFixed(2),
    async deliver(orderId: string, batchId: string, quantity: number) {
      items = [{ id: `si-${orderId}`, quantity, pickedBatchId: batchId }];
      return svc.debitForDeliveredOrder(
        client as unknown as Prisma.TransactionClient,
        orderId,
        'seller-1',
      );
    },
  };
}

/** ₹1,000 invoice + 5% = ₹1,050, over line A (6 units) and line B (4 units). */
function bill1050(over: Partial<Bill> = {}): Bill {
  return {
    id: 'fc-1',
    mode: InboundFreightMode.PAY_LATER,
    status: InboundFreightStatus.PENDING,
    totalInr: D('1050.00'),
    amountSettledInr: D('0'),
    unitsSettled: 0,
    totalUnits: 10,
    ...over,
  };
}

function lineA(over: Partial<Line> = {}): Line {
  return {
    id: 'a',
    batchId: 'batch-a',
    units: 6,
    unitsSettled: 0,
    lineTotalInr: D('600.00'),
    lineGrossInr: D('630.00'),
    amountSettledInr: D('0'),
    ...over,
  };
}

function lineB(over: Partial<Line> = {}): Line {
  return {
    id: 'b',
    batchId: 'batch-b',
    units: 4,
    unitsSettled: 0,
    lineTotalInr: D('400.00'),
    lineGrossInr: D('420.00'),
    amountSettledInr: D('0'),
    ...over,
  };
}

describe('a pay-later bill closes on its MONEY, and collects exactly its total', () => {
  it('the review scenario: A charged ₹600 before its gross existed, B then clears — the last unit takes the ₹30', async () => {
    // Line A's six units all left at the pre-charge rate (₹600), before
    // the backfill gave it a gross of ₹630. B's four units deliver now:
    // ₹420 for themselves. The bill used to close SETTLED at ₹1,020 of
    // ₹1,050 — A's ₹30 uncollectable, `settle` refusing a SETTLED bill,
    // and the P&L booking the full ₹1,050 all the same.
    const w = world(
      bill1050({
        status: InboundFreightStatus.PARTIALLY_SETTLED,
        amountSettledInr: D('600.00'),
        unitsSettled: 6,
      }),
      [lineA({ unitsSettled: 6, amountSettledInr: D('600.00') }), lineB()],
    );

    const r = await w.deliver('order-b', 'batch-b', 4);

    expect(r.amountInr).toBe('450');
    // ₹600 earlier + ₹450 now = ₹1,050, to the paisa.
    expect(w.bill.amountSettledInr.toFixed(2)).toBe('1050.00');
    expect(w.bill.status).toBe(InboundFreightStatus.SETTLED);
    expect(w.lines.map((l) => l.amountSettledInr.toFixed(2))).toEqual(['630.00', '420.00']);
  });

  it('a reopened bill: a returned-and-resold unit takes EVERY line’s residue, not only its own', async () => {
    // Both lines went at pre-charge rates, every unit has left, and the
    // migration reopened the bill as PARTIALLY_SETTLED at ₹1,000 of ₹1,050.
    // One unit of A comes back and sells again. It owes A's ₹30 catch-up;
    // on the unit-count rule it would then close the bill with B's ₹20
    // still missing.
    const w = world(
      bill1050({
        status: InboundFreightStatus.PARTIALLY_SETTLED,
        amountSettledInr: D('1000.00'),
        unitsSettled: 10,
      }),
      [
        lineA({ unitsSettled: 6, amountSettledInr: D('600.00') }),
        lineB({ unitsSettled: 4, amountSettledInr: D('400.00') }),
      ],
    );

    const r = await w.deliver('order-resold', 'batch-a', 1);

    expect(r.amountInr).toBe('50');
    expect(w.bill.amountSettledInr.toFixed(2)).toBe('1050.00');
    expect(w.bill.status).toBe(InboundFreightStatus.SETTLED);
    expect(w.lines.map((l) => l.amountSettledInr.toFixed(2))).toEqual(['630.00', '420.00']);
  });

  it('a bill charged at its gross from the start has no residue — ₹630 then ₹420, closed on the second', async () => {
    const w = world(bill1050(), [lineA(), lineB()]);

    await w.deliver('order-a', 'batch-a', 6);
    expect(w.collectedNow()).toBe('630.00');
    expect(w.bill.status).toBe(InboundFreightStatus.PARTIALLY_SETTLED);

    await w.deliver('order-b', 'batch-b', 4);
    expect(w.collectedNow()).toBe('1050.00');
    expect(w.bill.amountSettledInr.toFixed(2)).toBe('1050.00');
    expect(w.bill.status).toBe(InboundFreightStatus.SETTLED);
  });

  it('unit by unit, the lifetime total is exactly the bill — never a paisa over or under', async () => {
    // ₹1,000 + 3.33% on awkward lines: 7 units and 3 units.
    const w = world(bill1050({ totalInr: D('1033.30'), totalUnits: 10 }), [
      lineA({ units: 7, lineTotalInr: D('700.00'), lineGrossInr: D('723.31') }),
      lineB({ units: 3, lineTotalInr: D('300.00'), lineGrossInr: D('309.99') }),
    ]);
    for (let i = 0; i < 7; i += 1) await w.deliver(`a-${i}`, 'batch-a', 1);
    for (let i = 0; i < 3; i += 1) await w.deliver(`b-${i}`, 'batch-b', 1);
    expect(w.collectedNow()).toBe('1033.30');
    expect(w.bill.status).toBe(InboundFreightStatus.SETTLED);
  });

  it('once settled, a further unit out of the bill charges nothing', async () => {
    const w = world(
      bill1050({
        status: InboundFreightStatus.SETTLED,
        amountSettledInr: D('1050.00'),
        unitsSettled: 10,
      }),
      [
        lineA({ unitsSettled: 6, amountSettledInr: D('630.00') }),
        lineB({ unitsSettled: 4, amountSettledInr: D('420.00') }),
      ],
    );
    const r = await w.deliver('order-late', 'batch-a', 1);
    expect(r.amountInr).toBe('0');
    expect(w.debits).toHaveLength(0);
  });
});
