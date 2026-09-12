import { Currency, Prisma, WalletEntryDirection } from '@skydrop/db';
import {
  AdvisoryLock,
  ATTRIBUTION_RECONCILE_KEY,
  advisoryKey,
} from '../../src/common/db/advisory-lock';
import { SellerCashAttributionService } from '../../src/modules/treasury/services/seller-cash-attribution.service';

const D = (v: string): Prisma.Decimal => new Prisma.Decimal(v);

interface Created {
  signedAmount: Prisma.Decimal;
  ownerKind: string;
  sellerId: string | null;
  type: string;
  currency: string;
  note: string;
  /** The rupee book value the entry carried, when one was given. */
  inrBookValue: string | null;
}

function makeTx(opts: {
  /** Holdings: units, and — for a non-rupee account — their rupee book value. */
  held?: Array<{
    accountId: string;
    amount: Prisma.Decimal;
    currency?: Currency;
    book?: Prisma.Decimal;
  }>;
  anyAccount?: string | null;
  /**
   * The seller's wallet balance — before the cash arrives for debtSplit,
   * after the entry for apply; absent = no entries.
   */
  balance?: Prisma.Decimal;
  /** The latest accepted top-up into a taka account: what arrived, what was credited. */
  topup?: { amount: string; credited: string } | null;
  /** Today's rate row, "1 fromCurrency = rate toCurrency". */
  fx?: { fromCurrency: Currency; rate: string } | null;
}) {
  const created: Created[] = [];
  const tx = {
    $executeRaw: jest.fn(async () => 1),
    sellerWalletEntry: {
      findFirst: async () =>
        opts.balance === undefined ? null : { runningBalanceAfter: opts.balance },
    },
    bankEntry: {
      groupBy: async () =>
        (opts.held ?? []).map((h) => ({
          accountId: h.accountId,
          currency: h.currency ?? Currency.INR,
          _sum: { signedAmount: h.amount, inrBookValue: h.book ?? null },
        })),
    },
    walletTopupRequest: {
      findFirst: async () =>
        opts.topup
          ? { amount: D(opts.topup.amount), walletEntry: { amount: D(opts.topup.credited) } }
          : null,
    },
    fxRate: {
      findFirst: async () =>
        opts.fx ? { fromCurrency: opts.fx.fromCurrency, rate: D(opts.fx.rate) } : null,
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

/**
 * A stand-in for the real ledger writer.
 *
 * The attribution now goes through `BankLedgerService.post()` (TRE-1) so
 * it inherits the account, currency and owner guards. Those are pinned
 * in the ledger's own tests and end to end; here we only care WHAT it is
 * asked to write.
 */
function makeLedger(created: Created[]) {
  return {
    post: async (input: {
      signedAmount: Prisma.Decimal;
      owner: { kind: string; sellerId?: string };
      type: string;
      amountCurrency: string;
      note?: string | null;
      inrBookValue?: Prisma.Decimal | null;
    }) => {
      created.push({
        signedAmount: input.signedAmount,
        ownerKind: input.owner.kind,
        sellerId: input.owner.sellerId ?? null,
        type: input.type,
        currency: input.amountCurrency,
        note: input.note ?? '',
        inrBookValue:
          input.inrBookValue === undefined || input.inrBookValue === null
            ? null
            : input.inrBookValue.toString(),
      });
      return { id: `be-${created.length}` };
    },
  };
}

async function run(
  opts: Parameters<typeof makeTx>[0],
  direction: WalletEntryDirection,
  amount: string,
): Promise<Created[]> {
  const { tx, created } = makeTx(opts);
  const svc = new SellerCashAttributionService(makeLedger(created) as never);
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
    // In credit either side of it: ₹1,000 → ₹1,200.
    const created = await run(
      { held: [{ accountId: 'acc-1', amount: D('1000') }], balance: D('1200') },
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

  it.each([
    ['in credit', '500', '0', '1000'],
    ['with no wallet entries', null, '0', '1000'],
    ['in debt by less than the cash', '-300', '300', '700'],
    ['in debt by more than the cash', '-1500', '1000', '0'],
  ])(
    'splits ₹1,000 arriving for a seller %s into debt repaid and theirs',
    async (_label, balance, toCapital, toSeller) => {
      const { tx, created } = makeTx(balance === null ? {} : { balance: D(balance) });
      const svc = new SellerCashAttributionService(makeLedger(created) as never);
      const split = await svc.debtSplit(tx as never, 's1', D('1000'));
      expect(split.toCapital.toString()).toBe(toCapital);
      expect(split.toSeller.toString()).toBe(toSeller);
      // Under the wallet lock — the balance cannot move underneath it.
      expect(tx.$executeRaw).toHaveBeenCalled();
    },
  );

  it('fronts cash from capital to the seller as a zero-sum pair', async () => {
    const { tx, created } = makeTx({});
    const svc = new SellerCashAttributionService(makeLedger(created) as never);
    await svc.front(tx as never, {
      sellerId: 's1',
      amount: D('847.46'),
      accountId: 'acc-cod',
      reference: 'order-1',
    });
    expect(created.map((c) => [c.ownerKind, c.signedAmount.toString()])).toEqual([
      ['SELLER', '847.46'],
      ['CAPITAL', '-847.46'],
    ]);
  });

  it('fronts nothing when there is nothing to front', async () => {
    const { tx, created } = makeTx({});
    const svc = new SellerCashAttributionService(makeLedger(created) as never);
    await svc.front(tx as never, {
      sellerId: 's1',
      amount: D('0'),
      accountId: null,
      reference: 'order-1',
    });
    expect(created).toHaveLength(0);
  });

  it('moves cash that repays a debt to capital, in the account it landed in', async () => {
    const { tx, created } = makeTx({});
    const svc = new SellerCashAttributionService(makeLedger(created) as never);
    await svc.repayDebt(tx as never, {
      sellerId: 's1',
      accountId: 'acc-bdt',
      currency: Currency.BDT,
      amount: D('2500'),
      reference: 'we-1',
    });
    expect(created.map((c) => [c.ownerKind, c.signedAmount.toString()])).toEqual([
      ['SELLER', '-2500'],
      ['CAPITAL', '2500'],
    ]);
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

  describe('a seller whose money is partly in taka', () => {
    const summary = (c: Created[]): string[][] =>
      c.map((x) => [x.ownerKind, x.signedAmount.toString(), x.currency]);

    it('a charge beyond their rupees continues into their taka, at their average rate there', async () => {
      // ₹100 at HDFC, ৳10,000 at Tasin worth ₹8,000 (₹0.80 a taka).
      // A ₹300 charge takes the ₹100, then ₹200 of taka = ৳250.
      const created = await run(
        {
          held: [
            { accountId: 'tasin', amount: D('10000'), currency: Currency.BDT, book: D('8000') },
            { accountId: 'hdfc', amount: D('100') },
          ],
        },
        WalletEntryDirection.ORDER_CHARGES,
        '300',
      );
      expect(summary(created)).toEqual([
        ['SELLER', '-100', 'INR'],
        ['CAPITAL', '100', 'INR'],
        ['SELLER', '-250', 'BDT'],
        ['CAPITAL', '250', 'BDT'],
      ]);
      expect(created[2]?.note).toContain('average');
      // The book falls by exactly the rupees charged.
      expect(created[2]?.inrBookValue).toBe('-200');
    });

    it('two top-ups at different rates: a charge of it all takes every unit and every rupee', async () => {
      // ৳1,000 at ₹0.70 and ৳1,000 at ₹0.80 — ৳2,000 worth ₹1,500. Valued
      // at the last top-up's ₹0.80 it read ₹1,600, and a ₹1,500 charge took
      // ৳1,875 and left ৳125 "theirs" against a wallet at zero.
      const created = await run(
        {
          held: [
            { accountId: 'tasin', amount: D('2000'), currency: Currency.BDT, book: D('1500') },
          ],
        },
        WalletEntryDirection.RTO_FEE,
        '1500',
      );
      expect(summary(created)).toEqual([
        ['SELLER', '-2000', 'BDT'],
        ['CAPITAL', '2000', 'BDT'],
      ]);
      expect(created[0]?.inrBookValue).toBe('-1500');
    });

    it('the last unit carries the rounding, so a spent holding is exactly 0 and ₹0', async () => {
      // ৳1.00 worth ₹100 (a rate chosen so rounding bites): ₹99.90 is ৳0.999,
      // which rounds to the whole ৳1.00 while ₹0.10 of book remains. The
      // last unit is left to carry it, and the next charge takes both.
      const first = await run(
        {
          held: [{ accountId: 'tasin', amount: D('1'), currency: Currency.BDT, book: D('100') }],
        },
        WalletEntryDirection.ORDER_CHARGES,
        '99.90',
      );
      expect(first[0]?.signedAmount.toString()).toBe('-0.99');
      expect(first[0]?.inrBookValue).toBe('-99.9');
      const last = await run(
        {
          held: [
            { accountId: 'tasin', amount: D('0.01'), currency: Currency.BDT, book: D('0.10') },
          ],
        },
        WalletEntryDirection.ORDER_CHARGES,
        '5',
      );
      expect(last[0]?.signedAmount.toString()).toBe('-0.01');
      expect(last[0]?.inrBookValue).toBe('-0.1');
    });

    it('takes the ONE attribution reconcile key, so reconcile never folds a charge in', async () => {
      const { tx, created } = makeTx({ held: [{ accountId: 'hdfc', amount: D('100') }] });
      const svc = new SellerCashAttributionService(makeLedger(created) as never);
      await svc.takeToCapital(tx as never, {
        sellerId: 's1',
        amount: D('10'),
        reference: 'r',
        note: 'n',
      });
      expect(tx.$executeRaw).toHaveBeenCalledWith(
        expect.anything(),
        AdvisoryLock.BANK_RECONCILE,
        advisoryKey(ATTRIBUTION_RECONCILE_KEY),
      );
    });

    it('never takes more than they hold, and says how much it took', async () => {
      const { tx, created } = makeTx({
        held: [{ accountId: 'tasin', amount: D('100'), currency: Currency.BDT, book: D('80') }],
      });
      const svc = new SellerCashAttributionService(makeLedger(created) as never);
      const moved = await svc.takeToCapital(tx as never, {
        sellerId: 's1',
        amount: D('500'),
        reference: 'r',
        note: 'n',
      });
      // ৳100 at ₹0.80 is all there is: ₹80 moved, ₹420 stays a receivable.
      expect(moved.toString()).toBe('80');
      expect(summary(created)).toEqual([
        ['SELLER', '-100', 'BDT'],
        ['CAPITAL', '100', 'BDT'],
      ]);
    });

    it('leaves a holding it cannot value alone rather than guess a rate', async () => {
      const created = await run(
        { held: [{ accountId: 'tasin', amount: D('1000'), currency: Currency.BDT }], fx: null },
        WalletEntryDirection.ORDER_CHARGES,
        '100',
      );
      expect(created).toHaveLength(0);
    });
  });

  describe('a refund to a seller who owes us', () => {
    it('moves nothing while they are still in debt after it — it repaid the debt', async () => {
      // −₹300 → −₹100: nothing of it is theirs yet.
      const created = await run(
        { held: [], balance: D('-100') },
        WalletEntryDirection.ORDER_CHARGES_REFUND,
        '200',
      );
      expect(created).toHaveLength(0);
    });

    it('moves only the part that lifts them above zero', async () => {
      // −₹150 → +₹50: ₹150 repays the debt (ours), ₹50 is theirs.
      const created = await run(
        { held: [], balance: D('50') },
        WalletEntryDirection.SCRAP_REFUND,
        '200',
      );
      expect(created.map((c) => [c.ownerKind, c.signedAmount.toString()])).toEqual([
        ['SELLER', '50'],
        ['CAPITAL', '-50'],
      ]);
      expect(created[0]?.note).toContain('repaid their debt');
    });
  });
});
