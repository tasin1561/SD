import { Prisma } from '@skydrop/db';
import { LiabilitiesService } from '../../src/modules/treasury/services/liabilities.service';
import type { PrismaService } from '../../src/infrastructure/prisma/prisma.service';

const D = (v: string): Prisma.Decimal => new Prisma.Decimal(v);

function makeSut(opts: {
  balances?: Array<{ sellerId: string; balance: Prisma.Decimal }>;
  withdrawals?: Prisma.Decimal | null;
  gst?: Prisma.Decimal | null;
  freight?: Array<{ totalInr: Prisma.Decimal; amountSettledInr: Prisma.Decimal }>;
  cod?: Array<{ codAmountInr: Prisma.Decimal | null }>;
  sellers?: Array<{ id: string; companyName: string }>;
  stock?: Array<{
    sellerId: string;
    qtyOnHand: number;
    batch: { unitCostInr: Prisma.Decimal | null } | null;
  }>;
  lastSolventEntryId?: { id: string; runningBalanceAfter: Prisma.Decimal } | null;
  paidSince?: Prisma.Decimal | null;
  causes?: Array<{ direction: string; _sum: { amount: Prisma.Decimal | null } }>;
}) {
  const client = {
    sellerWalletBalance: { findMany: async () => opts.balances ?? [] },
    withdrawalRequest: {
      aggregate: async () => ({
        _sum: { amountRequested: opts.withdrawals ?? null },
        _count: { _all: opts.withdrawals === undefined ? 0 : 1 },
      }),
    },
    gstWithholding: {
      aggregate: async () => ({
        _sum: { gstAmountInr: opts.gst ?? null },
        _count: { _all: opts.gst === undefined ? 0 : 1 },
      }),
    },
    inboundFreightCharge: { findMany: async () => opts.freight ?? [] },
    order: {
      aggregate: async () => ({
        _sum: {
          codAmountInr: (opts.cod ?? []).reduce(
            (a, r) => a.add(r.codAmountInr ?? new Prisma.Decimal(0)),
            new Prisma.Decimal(0),
          ),
        },
        _count: { _all: (opts.cod ?? []).length },
      }),
    },
    seller: { findMany: async () => opts.sellers ?? [] },
    sellerWalletEntry: {
      // The last point the seller stood at zero or above; null means
      // they have never been solvent, so the whole ledger counts.
      findFirst: async () => opts.lastSolventEntryId ?? null,
      groupBy: async () => opts.causes ?? [],
      aggregate: async () => ({ _sum: { amount: opts.paidSince ?? null } }),
    },
    stockLevel: { findMany: async () => opts.stock ?? [] },
  };
  return new LiabilitiesService({ client } as unknown as PrismaService);
}

describe('LiabilitiesService', () => {
  it('does NOT count a requested withdrawal as a second debt', async () => {
    // The request is a subset of the wallet balance, not another
    // liability. Adding it would overstate what we owe by whatever is in
    // flight — and that error grows precisely when payouts are busiest.
    const r = await makeSut({
      balances: [{ sellerId: 's1', balance: D('50000') }],
      withdrawals: D('20000'),
    }).report();

    expect(r.owedTotalInr).toBe('50000.00');
    // Still SHOWN, because "how much of that has been asked for" is the
    // question about timing that the total cannot answer.
    expect(r.owed.find((l) => l.key === 'pending_withdrawals')?.amountInr).toBe('20000.00');
  });

  it('never lets a seller who owes us cancel out one we owe', async () => {
    // Two different people. Neither debt is settled by the other
    // existing, so they sit on opposite sides of the report.
    const r = await makeSut({
      balances: [
        { sellerId: 's1', balance: D('30000') },
        { sellerId: 's2', balance: D('-8000') },
      ],
      sellers: [{ id: 's2', companyName: 'Debtor Co' }],
    }).report();

    expect(r.owedTotalInr).toBe('30000.00');
    expect(r.due.find((l) => l.key === 'seller_debts')?.amountInr).toBe('8000.00');
  });

  it('values a debt against stock at COST, and flags the uncovered ones', async () => {
    const r = await makeSut({
      balances: [
        { sellerId: 's1', balance: D('-5000') },
        { sellerId: 's2', balance: D('-9000') },
      ],
      sellers: [
        { id: 's1', companyName: 'Covered Co' },
        { id: 's2', companyName: 'Exposed Co' },
      ],
      stock: [
        { sellerId: 's1', qtyOnHand: 100, batch: { unitCostInr: D('80') } }, // 8,000
        { sellerId: 's2', qtyOnHand: 10, batch: { unitCostInr: D('50') } }, // 500
      ],
    }).report();

    const covered = r.sellerDebts.find((s) => s.sellerId === 's1');
    const exposed = r.sellerDebts.find((s) => s.sellerId === 's2');
    expect(covered?.stockValueInr).toBe('8000.00');
    expect(covered?.covered).toBe(true);
    expect(exposed?.stockValueInr).toBe('500.00');
    expect(exposed?.covered).toBe(false);
    // Largest debt first — that is the one to act on.
    expect(r.sellerDebts[0]?.sellerId).toBe('s2');
  });

  it('contributes NOTHING for a batch with no recorded cost, rather than guessing', async () => {
    // Erring toward chasing a debt that was already safe is the harmless
    // direction; inventing a cover is not.
    const r = await makeSut({
      balances: [{ sellerId: 's1', balance: D('-1000') }],
      sellers: [{ id: 's1', companyName: 'Unknown Cost Co' }],
      stock: [
        { sellerId: 's1', qtyOnHand: 500, batch: { unitCostInr: null } },
        { sellerId: 's1', qtyOnHand: 2, batch: { unitCostInr: D('100') } },
      ],
    }).report();

    expect(r.sellerDebts[0]?.stockValueInr).toBe('200.00');
    expect(r.sellerDebts[0]?.covered).toBe(false);
  });

  it('counts only the UNRECOVERED part of a part-settled freight bill', async () => {
    const r = await makeSut({
      freight: [
        { totalInr: D('10000'), amountSettledInr: D('4000') },
        { totalInr: D('5000'), amountSettledInr: D('0') },
      ],
    }).report();
    expect(r.due.find((l) => l.key === 'freight_outstanding')?.amountInr).toBe('11000.00');
  });

  it('totals unsettled COD as money the courier is holding', async () => {
    const r = await makeSut({
      cod: [{ codAmountInr: D('1200') }, { codAmountInr: D('800') }],
    }).report();
    const line = r.due.find((l) => l.key === 'courier_float');
    expect(line?.amountInr).toBe('2000.00');
    expect(line?.count).toBe(2);
  });

  it('every line carries what it means — a bare number moves the problem to the reader', async () => {
    const r = await makeSut({}).report();
    for (const l of [...r.owed, ...r.due]) expect(l.meaning.length).toBeGreaterThan(20);
  });

  it('says what the debt is FOR, largest cause first', async () => {
    // A total says a seller owes ₹9,000. This says it is ₹8,200 of
    // inbound freight and ₹800 of delivery fees — the difference
    // between chasing them and understanding them. Freight on stock that
    // has not sold clears itself; delivery fees on delivered orders do
    // not.
    const r = await makeSut({
      balances: [{ sellerId: 's1', balance: D('-9000') }],
      sellers: [{ id: 's1', companyName: 'Indebted Co' }],
      causes: [
        { direction: 'ORDER_CHARGES', _sum: { amount: D('800') } },
        { direction: 'INBOUND_FREIGHT', _sum: { amount: D('8200') } },
      ],
    }).report();

    expect(r.sellerDebts[0]?.causes).toEqual([
      { direction: 'INBOUND_FREIGHT', amountInr: '8200.00' },
      { direction: 'ORDER_CHARGES', amountInr: '800.00' },
    ]);
  });

  it('drops a cause that nets to nothing rather than listing a zero', async () => {
    const r = await makeSut({
      balances: [{ sellerId: 's1', balance: D('-100') }],
      sellers: [{ id: 's1', companyName: 'Co' }],
      causes: [
        { direction: 'RTO_FEE', _sum: { amount: D('100') } },
        { direction: 'COD_COLLECTION_FEE', _sum: { amount: null } },
      ],
    }).report();
    expect(r.sellerDebts[0]?.causes).toHaveLength(1);
  });

  it('the causes RECONCILE with the balance — opening − charges + paid = −owed', async () => {
    // Charges alone can exceed the debt, and left unexplained that reads
    // as an error. Two things account for the gap: what the seller had
    // in hand when the run of debt started, and what they have paid
    // since. Neither is netted off a particular cause — a top-up does
    // not pay the freight rather than the fees — but both have to be
    // visible or the parts do not add up to the total beside them.
    const r = await makeSut({
      balances: [{ sellerId: 's1', balance: D('-9000') }],
      sellers: [{ id: 's1', companyName: 'Co' }],
      lastSolventEntryId: { id: 'e1', runningBalanceAfter: D('5000') },
      causes: [
        { direction: 'INBOUND_FREIGHT', _sum: { amount: D('15200') } },
        { direction: 'ORDER_CHARGES', _sum: { amount: D('600') } },
        { direction: 'RTO_FEE', _sum: { amount: D('200') } },
      ],
      paidSince: D('2000'),
    }).report();

    const d = r.sellerDebts[0];
    const charges = (d?.causes ?? []).reduce((a, c) => a + Number(c.amountInr), 0);
    expect(charges).toBe(16000);
    expect(d?.openingBalanceInr).toBe('5000.00');
    expect(d?.paidSinceInr).toBe('2000.00');
    expect(Number(d?.openingBalanceInr) - charges + Number(d?.paidSinceInr)).toBe(
      -Number(d?.owedInr),
    );
  });

  it('a seller who was never solvent opens at zero, not at their first charge', async () => {
    const r = await makeSut({
      balances: [{ sellerId: 's1', balance: D('-3200') }],
      sellers: [{ id: 's1', companyName: 'Co' }],
      lastSolventEntryId: null,
      causes: [{ direction: 'INBOUND_FREIGHT', _sum: { amount: D('3200') } }],
    }).report();
    expect(r.sellerDebts[0]?.openingBalanceInr).toBe('0.00');
    expect(r.sellerDebts[0]?.paidSinceInr).toBe('0.00');
  });
});
