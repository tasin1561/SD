import { Currency, Prisma } from '@skydrop/db';
import { AdvisoryLock } from '../../src/common/db/advisory-lock';
import { BankTransferService } from '../../src/modules/treasury/services/bank-transfer.service';
import { SellerCashAttributionService } from '../../src/modules/treasury/services/seller-cash-attribution.service';

function make(
  fromCur: Currency,
  toCur: Currency,
  sellerHeld = '1000000',
  /** The latest accepted top-up per account: [what arrived, what the wallet was credited]. */
  topups: Record<string, [string, string]> = {},
) {
  const posted: Array<{ type: string; signedAmount: string; ownerKind: string }> = [];
  const notes: string[] = [];
  // The advisory-lock namespaces taken, in order.
  const locks: number[] = [];
  const ledger = {
    post: jest.fn(
      async (i: {
        type: string;
        signedAmount: Prisma.Decimal;
        owner: { kind: string };
        note?: string | null;
      }) => {
        posted.push({
          type: i.type,
          signedAmount: new Prisma.Decimal(i.signedAmount).toFixed(2),
          ownerKind: i.owner.kind,
        });
        notes.push(i.note ?? '');
        return { id: 'e' };
      },
    ),
    // What the source account holds for that seller. Generous by
    // default so the rate cases below stay about the rate.
    ownerBalance: jest.fn(async () => new Prisma.Decimal(sellerHeld)),
  };
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
          $executeRaw: async (_s: TemplateStringsArray, ns: number) => {
            locks.push(ns);
            return 1;
          },
          // What a seller's money in each account is worth in rupees.
          walletTopupRequest: {
            findFirst: async (a: { where: { bankAccountId: string } }) => {
              const t = topups[a.where.bankAccountId];
              return t === undefined
                ? null
                : {
                    amount: new Prisma.Decimal(t[0]),
                    walletEntry: { amount: new Prisma.Decimal(t[1]) },
                  };
            },
          },
          fxRate: { findFirst: async () => null },
        }),
    },
  };
  const svc = new BankTransferService(
    prisma as never,
    ledger as never,
    { log: jest.fn() } as never,
    new SellerCashAttributionService(ledger as never),
  );
  return { svc, posted, notes, locks };
}

const BASE = { fromAccountId: 'from', toAccountId: 'to', movedAt: new Date(), staffId: 's1' };

describe('BankTransferService — a seller’s money moved with no quote', () => {
  it('credits it at the rate their wallet holds each side at; the gap is FX_SPREAD', async () => {
    // Taka at Tasin were credited at ₹0.80 (৳10,000 → ₹8,000), so ₹1,000
    // of theirs is ৳1,250 of theirs. ৳1,300 arrived: ৳50 is ours. Credited
    // the whole ৳1,300, they would have been held ₹1,040 of value for a
    // wallet that says ₹1,000.
    const { svc, posted, notes } = make(Currency.INR, Currency.BDT, '1000000', {
      to: ['10000', '8000'],
    });
    const r = await svc.transfer({
      ...BASE,
      amountOut: '1000',
      amountIn: '1300',
      sellerId: 'seller-a',
    });
    expect(r.creditedToSeller).toBe('1250.00');
    expect(r.fxSpread).toBe('50.00');
    expect(posted).toEqual([
      { type: 'TRANSFER_OUT', signedAmount: '-1000.00', ownerKind: 'SELLER' },
      { type: 'TRANSFER_IN', signedAmount: '1250.00', ownerKind: 'SELLER' },
      { type: 'FX_SPREAD', signedAmount: '50.00', ownerKind: 'CAPITAL' },
    ]);
    expect(notes.at(-1)).toContain('no quote given');
  });

  it('refuses when there is no rate to value their money at — give a quote', async () => {
    const { svc, posted } = make(Currency.INR, Currency.BDT);
    await expect(
      svc.transfer({ ...BASE, amountOut: '1000', amountIn: '1300', sellerId: 'seller-a' }),
    ).rejects.toMatchObject({ response: { code: 'TRANSFER_QUOTE_REQUIRED' } });
    expect(posted).toHaveLength(0);
  });

  it('takes the seller’s wallet lock before the reconcile lock', async () => {
    const { svc, locks } = make(Currency.INR, Currency.INR);
    await svc.transfer({ ...BASE, amountOut: '100', amountIn: '100', sellerId: 'seller-a' });
    expect(locks).toEqual([AdvisoryLock.WALLET, AdvisoryLock.BANK_RECONCILE]);
  });
});

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

  it('does NOT check our own money', async () => {
    // Capital can genuinely go overdrawn, and refusing to RECORD money
    // that really left the bank would make the book disagree with the
    // statement — the one thing it must never do.
    const { svc, posted } = make(Currency.INR, Currency.INR, '0');
    await svc.transfer({ ...BASE, amountOut: '999999', amountIn: '999999' });
    expect(posted.map((p) => p.ownerKind)).toEqual(['CAPITAL', 'CAPITAL']);
  });
});
