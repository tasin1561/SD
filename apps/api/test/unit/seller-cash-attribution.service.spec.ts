import { Currency, Prisma, WalletEntryDirection } from '@skydrop/db';
import { SellerCashAttributionService } from '../../src/modules/treasury/services/seller-cash-attribution.service';

const D = (v: string): Prisma.Decimal => new Prisma.Decimal(v);

interface Created {
  accountId: string;
  currency: string;
  signedAmount: Prisma.Decimal;
  ownerKind: string;
  sellerId: string | null;
  type: string;
  note: string;
}

interface Held {
  accountId: string;
  amount: Prisma.Decimal;
  currency?: Currency;
}

function makeTx(opts: {
  held?: Held[];
  anyAccount?: string | null;
  /** The seller's wallet balance as of its last entry; absent = no entries. */
  balance?: Prisma.Decimal;
  /** The seller's latest accepted top-up into an account: what landed, what was credited. */
  topup?: { amount: string; credited: string } | null;
  /** Today's rate, BDT → INR. */
  fxBdtToInr?: string | null;
}) {
  const created: Created[] = [];
  const held = (opts.held ?? []).map((h) => ({ ...h, currency: h.currency ?? Currency.INR }));
  const tx = {
    $executeRaw: jest.fn(async () => 1),
    sellerWalletEntry: {
      findFirst: async () =>
        opts.balance === undefined ? null : { runningBalanceAfter: opts.balance },
    },
    bankEntry: {
      // Grouped by account (one currency asked for) or by account AND
      // currency (every holding) — the fake answers both shapes.
      groupBy: async (a: { by: string[]; where: { currency?: Currency } }) =>
        held
          .filter((h) => a.where.currency === undefined || h.currency === a.where.currency)
          .map((h) => ({
            accountId: h.accountId,
            ...(a.by.includes('currency') ? { currency: h.currency } : {}),
            _sum: { signedAmount: h.amount },
          })),
    },
    walletTopupRequest: {
      findFirst: async () =>
        opts.topup === undefined || opts.topup === null
          ? null
          : { amount: D(opts.topup.amount), walletEntry: { amount: D(opts.topup.credited) } },
    },
    fxRate: {
      findUnique: async (a: {
        where: { fromCurrency_toCurrency: { fromCurrency: string; toCurrency: string } };
      }) =>
        opts.fxBdtToInr !== undefined &&
        opts.fxBdtToInr !== null &&
        a.where.fromCurrency_toCurrency.fromCurrency === Currency.BDT
          ? { rate: D(opts.fxBdtToInr) }
          : null,
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
      accountId: string;
      amountCurrency: string;
      signedAmount: Prisma.Decimal;
      owner: { kind: string; sellerId?: string };
      type: string;
      note?: string;
    }) => {
      created.push({
        accountId: input.accountId,
        currency: input.amountCurrency,
        signedAmount: input.signedAmount,
        ownerKind: input.owner.kind,
        sellerId: input.owner.sellerId ?? null,
        type: input.type,
        note: input.note ?? '',
      });
      return { id: `be-${created.length}` };
    },
  };
}

async function run(
  opts: Parameters<typeof makeTx>[0],
  direction: WalletEntryDirection,
  amount: string,
  balanceAfter?: string,
): Promise<Created[]> {
  const { tx, created } = makeTx(opts);
  const svc = new SellerCashAttributionService(makeLedger(created) as never);
  await svc.apply(tx as never, {
    sellerId: 's1',
    currency: Currency.INR,
    direction,
    amount: D(amount),
    walletEntryId: 'we-1',
    ...(balanceAfter === undefined ? {} : { balanceAfter: D(balanceAfter) }),
  });
  return created;
}

const sellerSide = (created: Created[]): Array<[string, string, string]> =>
  created
    .filter((c) => c.ownerKind === 'SELLER')
    .map((c) => [c.accountId, c.currency, c.signedAmount.toFixed(2)]);

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

  it('takes rupees from each account in turn, never past what one holds', async () => {
    // ₹300 charged, ₹200 in one account and ₹150 in another: 200 from the
    // larger, 100 from the next — neither account's seller figure can go
    // negative, which one pair on the largest account could.
    const created = await run(
      {
        held: [
          { accountId: 'small', amount: D('150') },
          { accountId: 'big', amount: D('200') },
        ],
      },
      WalletEntryDirection.ORDER_CHARGES,
      '300',
    );
    expect(sellerSide(created)).toEqual([
      ['big', 'INR', '-200.00'],
      ['small', 'INR', '-100.00'],
    ]);
  });

  describe('when their rupees run out, the charge continues into their other currencies', () => {
    it('at the rate their taka top-up was credited at', async () => {
      // ₹50 in rupees, ৳1,300 that arrived as a top-up credited ₹1,000.
      // ₹200 charged: ₹50 from the rupees, and ₹150 more at 1,300 per
      // 1,000 — ৳195.00 of the taka becomes ours.
      const created = await run(
        {
          held: [
            { accountId: 'hdfc', amount: D('50') },
            { accountId: 'tasin', amount: D('1300'), currency: Currency.BDT },
          ],
          topup: { amount: '1300', credited: '1000' },
        },
        WalletEntryDirection.ORDER_CHARGES,
        '200',
      );
      expect(sellerSide(created)).toEqual([
        ['hdfc', 'INR', '-50.00'],
        ['tasin', 'BDT', '-195.00'],
      ]);
      // Each pair is in its own account's currency, and sums to zero there.
      const tasin = created.filter((c) => c.accountId === 'tasin');
      expect(tasin.every((c) => c.currency === 'BDT')).toBe(true);
      expect(tasin.reduce((t, c) => t.add(c.signedAmount), D('0')).isZero()).toBe(true);
      expect(tasin[0]?.note).toContain('top-up');
    });

    it("falls back to today's rate only when there is no top-up, and says so", async () => {
      // ৳1,000 at today's 0.80 is ₹800; ₹400 charged takes ৳500.
      const created = await run(
        {
          held: [{ accountId: 'tasin', amount: D('1000'), currency: Currency.BDT }],
          topup: null,
          fxBdtToInr: '0.80',
        },
        WalletEntryDirection.INBOUND_FREIGHT,
        '400',
      );
      expect(sellerSide(created)).toEqual([['tasin', 'BDT', '-500.00']]);
      expect(created[0]?.note).toContain("today's rate");
    });

    it('never takes more taka than they hold', async () => {
      // ৳100 is worth ₹76.92 at the credited rate; a ₹200 charge takes it
      // all and leaves the rest as a receivable.
      const created = await run(
        {
          held: [{ accountId: 'tasin', amount: D('100'), currency: Currency.BDT }],
          topup: { amount: '1300', credited: '1000' },
        },
        WalletEntryDirection.ORDER_CHARGES,
        '200',
      );
      expect(sellerSide(created)).toEqual([['tasin', 'BDT', '-100.00']]);
    });

    it('leaves a holding nothing can value alone rather than guessing', async () => {
      const created = await run(
        {
          held: [{ accountId: 'tasin', amount: D('1000'), currency: Currency.BDT }],
          topup: null,
          fxBdtToInr: null,
        },
        WalletEntryDirection.ORDER_CHARGES,
        '200',
      );
      expect(created).toHaveLength(0);
    });
  });

  describe('a refund gives back only the part that lifts the wallet above zero', () => {
    it('a seller in credit gets the whole refund back as cash', async () => {
      const created = await run(
        { held: [{ accountId: 'acc-1', amount: D('1000') }] },
        WalletEntryDirection.ORDER_CHARGES_REFUND,
        '200',
        '1200',
      );
      expect(created.find((c) => c.ownerKind === 'SELLER')?.signedAmount.toString()).toBe('200');
      expect(created.find((c) => c.ownerKind === 'CAPITAL')?.signedAmount.toString()).toBe(
        '-200',
      );
    });

    it('a seller at −₹150 refunded ₹200 is held ₹50 — the rest only shrank a receivable', async () => {
      const created = await run(
        { held: [] },
        WalletEntryDirection.SCRAP_REFUND,
        '200',
        '50', // −150 + 200
      );
      expect(created.map((c) => [c.ownerKind, c.signedAmount.toFixed(2)])).toEqual([
        ['SELLER', '50.00'],
        ['CAPITAL', '-50.00'],
      ]);
    });

    it('a seller still in debt after the refund is held nothing', async () => {
      const created = await run(
        { held: [] },
        WalletEntryDirection.COD_DEDUCTION_REFUND,
        '152.54',
        '-100.00',
      );
      expect(created).toHaveLength(0);
    });

    it('reads the balance back from the ledger when the caller does not pass it', async () => {
      // The entry is already written, so the ledger's last row IS "after".
      const created = await run(
        { held: [], balance: D('75') },
        WalletEntryDirection.ORDER_CHARGES_REFUND,
        '100',
      );
      expect(created.find((c) => c.ownerKind === 'SELLER')?.signedAmount.toString()).toBe('75');
    });
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

  it('counts cash they already hold in another currency before holding them more', async () => {
    // The wallet is ₹−200 but ৳1,300 (₹1,000 at the credited rate) still
    // sits against them from before a charge could reach it. ₹500 of COD
    // arriving would bring them to ₹300 owed — they already hold more than
    // that, so none of the ₹500 is theirs.
    const { tx, created } = makeTx({
      balance: D('-200'),
      held: [{ accountId: 'tasin', amount: D('1300'), currency: Currency.BDT }],
      topup: { amount: '1300', credited: '1000' },
    });
    const svc = new SellerCashAttributionService(makeLedger(created) as never);
    const split = await svc.debtSplit(tx as never, 's1', D('500'));
    expect(split.toSeller.toString()).toBe('0');
    expect(split.toCapital.toString()).toBe('500');
  });

  it('values every holding in rupees, taka at its credited rate', async () => {
    const { tx, created } = makeTx({
      held: [
        { accountId: 'hdfc', amount: D('250') },
        { accountId: 'tasin', amount: D('1300'), currency: Currency.BDT },
      ],
      topup: { amount: '1300', credited: '1000' },
    });
    const svc = new SellerCashAttributionService(makeLedger(created) as never);
    const all = await svc.sellerHeldAll(tx as never, 's1');
    expect(all.inr.toFixed(2)).toBe('250.00');
    expect(all.otherInr.toFixed(2)).toBe('1000.00');
    expect(all.totalInr.toFixed(2)).toBe('1250.00');
  });

  it('takeFromSeller can skip the rupees a caller already took itself', async () => {
    const { tx, created } = makeTx({
      held: [
        { accountId: 'hdfc', amount: D('250') },
        { accountId: 'tasin', amount: D('1300'), currency: Currency.BDT },
      ],
      topup: { amount: '1300', credited: '1000' },
    });
    const svc = new SellerCashAttributionService(makeLedger(created) as never);
    const moved = await svc.takeFromSeller(tx as never, {
      sellerId: 's1',
      amountInr: D('100'),
      reference: 'payout-1',
      note: 'COD reversed',
      skipInr: true,
    });
    expect(moved.toFixed(2)).toBe('100.00');
    expect(sellerSide(created)).toEqual([['tasin', 'BDT', '-130.00']]);
  });

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
    expect(sellerSide(created)).toEqual([['big', 'INR', '-50.00']]);
  });
});
