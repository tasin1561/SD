import { Currency, Prisma, WalletEntryDirection } from '@skydrop/db';
import { SellerCashAttributionService } from '../../src/modules/treasury/services/seller-cash-attribution.service';

const D = (v: string): Prisma.Decimal => new Prisma.Decimal(v);

interface Created {
  signedAmount: Prisma.Decimal;
  ownerKind: string;
  sellerId: string | null;
  type: string;
}

function makeTx(opts: {
  held?: Array<{ accountId: string; amount: Prisma.Decimal }>;
  anyAccount?: string | null;
}) {
  const created: Created[] = [];
  const tx = {
    bankEntry: {
      groupBy: async () =>
        (opts.held ?? []).map((h) => ({
          accountId: h.accountId,
          _sum: { signedAmount: h.amount },
        })),
      createMany: async (args: { data: Created[] }) => {
        created.push(...args.data);
        return { count: args.data.length };
      },
    },
    platformBankAccount: {
      findFirst: async () =>
        opts.anyAccount === undefined
          ? { id: 'fallback' }
          : opts.anyAccount === null
            ? null
            : { id: opts.anyAccount },
    },
  };
  return { tx, created };
}

const svc = new SellerCashAttributionService();

async function run(
  opts: Parameters<typeof makeTx>[0],
  direction: WalletEntryDirection,
  amount: string,
): Promise<Created[]> {
  const { tx, created } = makeTx(opts);
  await svc.apply(tx as never, {
    sellerId: 's1',
    currency: Currency.INR,
    direction,
    amount: D(amount),
    walletEntryId: 'we-1',
  });
  return created;
}

describe('SellerCashAttributionService', () => {
  it('a charge turns the seller’s held cash into OURS, as a zero-sum pair', async () => {
    // The cash does not leave the account, so one entry would change the
    // account total and make it disagree with the statement. What
    // changes is whose it is.
    const created = await run(
      { held: [{ accountId: 'acc-1', amount: D('5000') }] },
      WalletEntryDirection.ORDER_CHARGES,
      '200',
    );

    expect(created).toHaveLength(2);
    const seller = created.find((c) => c.ownerKind === 'SELLER');
    const capital = created.find((c) => c.ownerKind === 'CAPITAL');
    expect(seller?.signedAmount.toString()).toBe('-200');
    expect(capital?.signedAmount.toString()).toBe('200');
    expect(capital?.sellerId).toBeNull();
    expect(created.reduce((a, c) => a.add(c.signedAmount), new Prisma.Decimal(0)).toString()).toBe(
      '0',
    );
  });

  it('writes NOTHING when the seller holds no cash — the debt is a receivable', async () => {
    // The correction that matters: a negative wallet has nothing behind
    // it in any account. Inventing an entry would put a number in the
    // bank book that no statement will ever agree with.
    const created = await run({ held: [] }, WalletEntryDirection.INBOUND_FREIGHT, '8000');
    expect(created).toHaveLength(0);
  });

  it('CLAMPS to what is actually there, leaving the rest as a receivable', async () => {
    // Charging ₹200 to a seller holding ₹50 makes ₹50 ours. There is no
    // third ₹150 in any account to move.
    const created = await run(
      { held: [{ accountId: 'acc-1', amount: D('50') }] },
      WalletEntryDirection.RTO_FEE,
      '200',
    );
    expect(created).toHaveLength(2);
    expect(created.find((c) => c.ownerKind === 'CAPITAL')?.signedAmount.toString()).toBe('50');
  });

  it('never treats an already-negative holding as cash to take', async () => {
    const created = await run(
      { held: [{ accountId: 'acc-1', amount: D('-900') }] },
      WalletEntryDirection.ORDER_CHARGES,
      '100',
    );
    expect(created).toHaveLength(0);
  });

  it('a refund gives the cash back — the pair runs the other way', async () => {
    const created = await run(
      { held: [{ accountId: 'acc-1', amount: D('1000') }] },
      WalletEntryDirection.ORDER_CHARGES_REFUND,
      '200',
    );
    expect(created.find((c) => c.ownerKind === 'SELLER')?.signedAmount.toString()).toBe('200');
    expect(created.find((c) => c.ownerKind === 'CAPITAL')?.signedAmount.toString()).toBe('-200');
  });

  it('does NOT double-count the flows that already posted their own cash', async () => {
    // A top-up, a COD credit and a remittance each move real money and
    // are posted by the flow that moved it. Reclassifying here as well
    // would count the movement twice.
    for (const d of [
      WalletEntryDirection.TOPUP,
      WalletEntryDirection.COD_COLLECTION,
      WalletEntryDirection.REMITTANCE_OUT,
      WalletEntryDirection.REMITTANCE_FX,
    ]) {
      const created = await run({ held: [{ accountId: 'acc-1', amount: D('9000') }] }, d, '500');
      expect(created).toHaveLength(0);
    }
  });

  it('leaves an operator adjustment alone — the bank is reconciled on its own', async () => {
    for (const d of [
      WalletEntryDirection.ADJUSTMENT_CREDIT,
      WalletEntryDirection.ADJUSTMENT_DEBIT,
      WalletEntryDirection.OPENING_BALANCE,
    ]) {
      const created = await run({ held: [{ accountId: 'acc-1', amount: D('9000') }] }, d, '500');
      expect(created).toHaveLength(0);
    }
  });

  it('takes the cash from the account holding most of it', async () => {
    const created = await run(
      {
        held: [
          { accountId: 'small', amount: D('100') },
          { accountId: 'big', amount: D('9000') },
        ],
      },
      WalletEntryDirection.INSTANT_PAY_FEE,
      '50',
    );
    expect(created).toHaveLength(2);
  });
});
