import { Currency, Prisma } from '@skydrop/db';
import { BankTransferService } from '../../src/modules/treasury/services/bank-transfer.service';
import { AdvisoryLock } from '../../src/common/db/advisory-lock';

type Rate = { inr: Prisma.Decimal; local: Prisma.Decimal; source: string };

function make(
  fromCur: Currency,
  toCur: Currency,
  sellerHeld = '1000000',
  /** The rate each account's seller money was credited at; absent = none known. */
  rates: Record<string, { inr: string; local: string }> = {},
) {
  const posted: Array<{ type: string; signedAmount: string; ownerKind: string }> = [];
  const ledger = {
    post: jest.fn(
      async (i: { type: string; signedAmount: Prisma.Decimal; owner: { kind: string } }) => {
        posted.push({
          type: i.type,
          signedAmount: new Prisma.Decimal(i.signedAmount).toFixed(2),
          ownerKind: i.owner.kind,
        });
        return { id: 'e' };
      },
    ),
    // What the source account holds for that seller. Generous by
    // default so the rate cases below stay about the rate.
    ownerBalance: jest.fn(async () => new Prisma.Decimal(sellerHeld)),
  };
  // The advisory locks, in the order they were taken.
  const executeRaw = jest.fn(async (..._args: unknown[]) => 1);
  const prisma = {
    client: {
      platformBankAccount: {
        findUnique: jest.fn(async (a: { where: { id: string } }) => ({
          id: a.where.id,
          label: a.where.id,
          currency: a.where.id === 'from' ? fromCur : toCur,
          deletedAt: null,
        })),
      },
      bankTransfer: { create: jest.fn(async () => ({ id: 't1' })) },
      $transaction: async (fn: (tx: unknown) => unknown) =>
        fn({
          bankTransfer: { create: async () => ({ id: 't1' }) },
          // The bank-charges category a short same-currency transfer files under.
          expenseCategory: { upsert: async () => ({ id: 'cat-bank' }) },
          // The holding guard takes the same advisory lock reconcile
          // does; a mocked tx has to answer it or the whole transfer
          // fails for the wrong reason.
          $executeRaw: executeRaw,
        }),
    },
  };
  const attribution = {
    rateToInr: jest.fn(
      async (_tx: unknown, _s: string, accountId: string, currency: Currency) => {
        if (currency === Currency.INR) {
          return { inr: new Prisma.Decimal(1), local: new Prisma.Decimal(1), source: 'INR' };
        }
        const r = rates[accountId];
        return r === undefined
          ? null
          : ({
              inr: new Prisma.Decimal(r.inr),
              local: new Prisma.Decimal(r.local),
              source: 'TOPUP',
            } satisfies Rate);
      },
    ),
  };
  const svc = new BankTransferService(
    prisma as never,
    ledger as never,
    { log: jest.fn() } as never,
    attribution as never,
  );
  return { svc, posted, executeRaw };
}

const BASE = { fromAccountId: 'from', toAccountId: 'to', movedAt: new Date(), staffId: 's1' };

describe('BankTransferService — the quoted rate is a promise', () => {
  it('credits the seller at the QUOTED rate and keeps the upside', async () => {
    const { svc, posted } = make(Currency.INR, Currency.BDT);
    // ₹1,000 quoted at 1.30 → the seller is owed ৳1,300.
    // The bank gave 1.35 → ৳1,350 arrived, so ৳50 is ours.
    const r = await svc.transfer({
      ...BASE,
      amountOut: '1000',
      amountIn: '1350',
      quotedRate: '1.30',
      sellerId: 'seller-a',
    });

    expect(r.creditedToSeller).toBe('1300.00');
    expect(r.fxSpread).toBe('50.00');
    expect(r.achievedRate).toBe('1.35');
    expect(posted).toEqual([
      { type: 'TRANSFER_OUT', signedAmount: '-1000.00', ownerKind: 'SELLER' },
      { type: 'TRANSFER_IN', signedAmount: '1300.00', ownerKind: 'SELLER' },
      { type: 'FX_SPREAD', signedAmount: '50.00', ownerKind: 'CAPITAL' },
    ]);
  });

  it('honours the quote when the rate goes against us, from capital', async () => {
    const { svc, posted } = make(Currency.INR, Currency.BDT);
    // The bank gave 1.25 → only ৳1,250 arrived, but ৳1,300 was promised.
    // The seller still gets ৳1,300; the ৳50 comes out of capital.
    const r = await svc.transfer({
      ...BASE,
      amountOut: '1000',
      amountIn: '1250',
      quotedRate: '1.30',
      sellerId: 'seller-a',
    });

    expect(r.creditedToSeller).toBe('1300.00');
    expect(r.fxSpread).toBe('-50.00');
    expect(posted[1]).toEqual({
      type: 'TRANSFER_IN',
      signedAmount: '1300.00',
      ownerKind: 'SELLER',
    });
    expect(posted[2]).toEqual({
      type: 'FX_SPREAD',
      signedAmount: '-50.00',
      ownerKind: 'CAPITAL',
    });
  });

  it('a same-currency move of our own money posts two entries and no spread', async () => {
    const { svc, posted } = make(Currency.INR, Currency.INR);
    const r = await svc.transfer({ ...BASE, amountOut: '300', amountIn: '300' });
    expect(r.fxSpread).toBeNull();
    expect(posted).toEqual([
      { type: 'TRANSFER_OUT', signedAmount: '-300.00', ownerKind: 'CAPITAL' },
      { type: 'TRANSFER_IN', signedAmount: '300.00', ownerKind: 'CAPITAL' },
    ]);
  });

  it('books what a same-currency transfer lost on the way as OUR bank charge', async () => {
    // ₹300 left, ₹295 arrived. The ₹5 used to be refused ("record it as an
    // expense") and was then forgotten — on no line while the account total
    // quietly dropped. It is booked here, as an expense of ours.
    const { svc, posted } = make(Currency.INR, Currency.INR);
    const r = await svc.transfer({ ...BASE, amountOut: '300', amountIn: '295' });
    expect(r.bankCharge).toBe('5.00');
    expect(posted).toEqual([
      { type: 'TRANSFER_OUT', signedAmount: '-300.00', ownerKind: 'CAPITAL' },
      { type: 'TRANSFER_IN', signedAmount: '300.00', ownerKind: 'CAPITAL' },
      { type: 'EXPENSE', signedAmount: '-5.00', ownerKind: 'CAPITAL' },
    ]);
    // The receiving account moves by exactly what arrived.
    const arrived = posted
      .slice(1)
      .reduce((t, p) => t.add(new Prisma.Decimal(p.signedAmount)), new Prisma.Decimal(0));
    expect(arrived.toFixed(2)).toBe('295.00');
  });

  it("a seller's same-currency move keeps their whole holding — the charge is ours", async () => {
    const { svc, posted } = make(Currency.INR, Currency.INR);
    await svc.transfer({ ...BASE, amountOut: '300', amountIn: '295', sellerId: 'seller-a' });
    expect(posted).toEqual([
      { type: 'TRANSFER_OUT', signedAmount: '-300.00', ownerKind: 'SELLER' },
      { type: 'TRANSFER_IN', signedAmount: '300.00', ownerKind: 'SELLER' },
      { type: 'EXPENSE', signedAmount: '-5.00', ownerKind: 'CAPITAL' },
    ]);
  });

  it('refuses a same-currency transfer where MORE arrived than left', async () => {
    const { svc } = make(Currency.INR, Currency.INR);
    await expect(
      svc.transfer({ ...BASE, amountOut: '300', amountIn: '305' }),
    ).rejects.toMatchObject({ response: { code: 'TRANSFER_AMOUNT_MISMATCH' } });
  });

  it('refuses a transfer to the same account', async () => {
    const { svc } = make(Currency.INR, Currency.INR);
    await expect(
      svc.transfer({ ...BASE, toAccountId: 'from', amountOut: '10', amountIn: '10' }),
    ).rejects.toThrow();
  });
});

describe("BankTransferService — a seller's money crossing a currency with no quote", () => {
  it('crosses at the rate it was credited at, and the gap against the bank is FX_SPREAD', async () => {
    // ৳1,300 of theirs arrived as a top-up credited ₹1,000. Moved to a
    // rupee account with no quote, they are credited ₹1,000 — the value
    // their wallet already carries — and the bank's ₹990 leaves ₹10 for
    // us to cover. It used to credit "whatever arrived" (₹990): the gap
    // vanished into their holding and the book stopped matching the wallet.
    const { svc, posted } = make(Currency.BDT, Currency.INR, '1000000', {
      from: { inr: '1000', local: '1300' },
    });
    const r = await svc.transfer({
      ...BASE,
      amountOut: '1300',
      amountIn: '990',
      sellerId: 'seller-a',
    });
    expect(r.creditedToSeller).toBe('1000.00');
    expect(r.fxSpread).toBe('-10.00');
    expect(posted).toEqual([
      { type: 'TRANSFER_OUT', signedAmount: '-1300.00', ownerKind: 'SELLER' },
      { type: 'TRANSFER_IN', signedAmount: '1000.00', ownerKind: 'SELLER' },
      { type: 'FX_SPREAD', signedAmount: '-10.00', ownerKind: 'CAPITAL' },
    ]);
  });

  it('into taka, at the rate their taka there was credited at', async () => {
    // ₹1,000 → the taka account, where their top-up credited ₹1,000 for
    // ৳1,300: they are credited ৳1,300 and the bank's ৳1,350 leaves ৳50 ours.
    const { svc } = make(Currency.INR, Currency.BDT, '1000000', {
      to: { inr: '1000', local: '1300' },
    });
    const r = await svc.transfer({
      ...BASE,
      amountOut: '1000',
      amountIn: '1350',
      sellerId: 'seller-a',
    });
    expect(r.creditedToSeller).toBe('1300.00');
    expect(r.fxSpread).toBe('50.00');
  });

  it('refuses when no rate is known for their money at all', async () => {
    const { svc } = make(Currency.BDT, Currency.INR);
    await expect(
      svc.transfer({ ...BASE, amountOut: '1300', amountIn: '990', sellerId: 'seller-a' }),
    ).rejects.toMatchObject({ response: { code: 'TRANSFER_QUOTE_REQUIRED' } });
  });

  it('our own money across a currency is still credited with what arrived', async () => {
    const { svc, posted } = make(Currency.BDT, Currency.INR);
    const r = await svc.transfer({ ...BASE, amountOut: '1300', amountIn: '990' });
    expect(r.fxSpread).toBeNull();
    expect(posted[1]).toEqual({ type: 'TRANSFER_IN', signedAmount: '990.00', ownerKind: 'CAPITAL' });
  });
});

describe("BankTransferService — you cannot move more of a seller's money than they have", () => {
  it("refuses a transfer larger than the seller's holding in that account", async () => {
    // "Whose money" is a CHOICE on the form, not a fact off a statement.
    // Unchecked, this posts a negative held-for-seller figure — not a
    // real thing, and permanent, because the ledger is append-only.
    const { svc } = make(Currency.INR, Currency.INR, '1200');
    await expect(
      svc.transfer({ ...BASE, amountOut: '5000', amountIn: '5000', sellerId: 'seller-a' }),
    ).rejects.toMatchObject({
      response: { code: 'TRANSFER_EXCEEDS_SELLER_HOLDING' },
    });
  });

  it('allows exactly what they hold', async () => {
    // The boundary is inclusive: sending a seller their whole balance is
    // the ordinary case, not an error.
    const { svc, posted } = make(Currency.INR, Currency.INR, '1200');
    await svc.transfer({ ...BASE, amountOut: '1200', amountIn: '1200', sellerId: 'seller-a' });
    expect(posted).toHaveLength(2);
  });

  it("takes the seller's WALLET lock before the reconcile lock", async () => {
    // A charge reclassifies their cash under the wallet lock. Read their
    // holding without it and a transfer can move cash that just stopped
    // being theirs. WALLET first, everywhere, so the two never deadlock.
    const { svc, executeRaw } = make(Currency.INR, Currency.INR, '1200');
    await svc.transfer({ ...BASE, amountOut: '100', amountIn: '100', sellerId: 'seller-a' });
    expect(executeRaw.mock.calls.map((c) => c[1])).toEqual([
      AdvisoryLock.WALLET,
      AdvisoryLock.BANK_RECONCILE,
    ]);
  });

  it('does NOT check our own money', async () => {
    // Capital can genuinely go overdrawn, and refusing to RECORD money
    // that really left the bank would make the book disagree with the
    // statement — the one thing it must never do.
    const { svc, posted } = make(Currency.INR, Currency.INR, '0');
    await svc.transfer({ ...BASE, amountOut: '999999', amountIn: '999999' });
    expect(posted.map((p) => p.ownerKind)).toEqual(['CAPITAL', 'CAPITAL']);
  });
});
