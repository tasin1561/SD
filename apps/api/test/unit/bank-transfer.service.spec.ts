import { Currency, Prisma } from '@skydrop/db';
import { AdvisoryLock } from '../../src/common/db/advisory-lock';
import { BankTransferService } from '../../src/modules/treasury/services/bank-transfer.service';

const D = (v: string): Prisma.Decimal => new Prisma.Decimal(v);

interface PriorTransfer {
  id: string;
  fromAccountId: string;
  toAccountId: string;
  amountOut: Prisma.Decimal;
  amountIn: Prisma.Decimal;
  currencyOut: Currency;
  currencyIn: Currency;
  sellerId: string | null;
  quotedRate: Prisma.Decimal | null;
  achievedRate: Prisma.Decimal | null;
  entries: Array<{ type: string; signedAmount: Prisma.Decimal }>;
}

function make(
  fromCur: Currency,
  toCur: Currency,
  sellerHeld = '1000000',
  opts: {
    /** What one unit of the seller's money in the SENDING account is worth to their wallet. */
    inrPerUnit?: string;
    /** A transfer already recorded under the same idempotency key. */
    prior?: PriorTransfer | null;
  } = {},
) {
  const posted: Array<{ type: string; signedAmount: string; ownerKind: string }> = [];
  // The rupee book value each entry carried, in the same order as `posted`.
  const books: Array<string | null> = [];
  const notes: string[] = [];
  // The advisory-lock namespaces taken, in order.
  const locks: number[] = [];
  const created: unknown[] = [];
  const ledger = {
    post: jest.fn(
      async (i: {
        type: string;
        signedAmount: Prisma.Decimal;
        owner: { kind: string };
        note?: string | null;
        inrBookValue?: Prisma.Decimal | null;
      }) => {
        posted.push({
          type: i.type,
          signedAmount: new Prisma.Decimal(i.signedAmount).toFixed(2),
          ownerKind: i.owner.kind,
        });
        books.push(
          i.inrBookValue === undefined || i.inrBookValue === null
            ? null
            : new Prisma.Decimal(i.inrBookValue).toFixed(2),
        );
        notes.push(i.note ?? '');
        return { id: 'e' };
      },
    ),
    // What the source account holds for that seller. Generous by
    // default so the rate cases below stay about the rate.
    ownerBalance: jest.fn(async () => new Prisma.Decimal(sellerHeld)),
    // Rupees are their own value; anything else at the seller's average
    // there (the real arithmetic is pinned in the ledger's own spec).
    inrValueOfSellerUnits: jest.fn(
      async (_s: string, _a: string, cur: Currency, units: Prisma.Decimal) =>
        cur === Currency.INR ? units : units.mul(D(opts.inrPerUnit ?? '0.8')).toDecimalPlaces(2),
    ),
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
      bankTransfer: { findUnique: jest.fn(async () => opts.prior ?? null) },
      $transaction: async (fn: (tx: unknown) => unknown) =>
        fn({
          bankTransfer: {
            create: async (a: { data: unknown }) => {
              created.push(a.data);
              return { id: 't1' };
            },
          },
          // The bank-charges category a short same-currency transfer files under.
          expenseCategory: { upsert: async () => ({ id: 'cat-bank' }) },
          // The holding guard takes the same advisory lock reconcile
          // does; a mocked tx has to answer it or the whole transfer
          // fails for the wrong reason.
          $executeRaw: async (_s: TemplateStringsArray, ns: number) => {
            locks.push(ns);
            return 1;
          },
        }),
    },
  };
  const svc = new BankTransferService(
    prisma as never,
    ledger as never,
    { log: jest.fn() } as never,
  );
  return { svc, posted, books, notes, locks, created, ledger };
}

const BASE = { fromAccountId: 'from', toAccountId: 'to', movedAt: new Date(), staffId: 's1' };

describe('BankTransferService — a seller’s money moved with no quote', () => {
  it('into taka: credits what actually arrived, carrying the rupees that left — no spread', async () => {
    // It used to invent a quote from the seller's "last top-up rate" on
    // each side and book the gap as FX — a phantom gain or loss on every
    // such move. Their money simply moved: the taka that arrived are
    // theirs, and worth to their wallet exactly what left.
    const { svc, posted, books } = make(Currency.INR, Currency.BDT);
    const r = await svc.transfer({
      ...BASE,
      amountOut: '1000',
      amountIn: '1300',
      sellerId: 'seller-a',
    });
    expect(r.creditedToSeller).toBe('1300.00');
    expect(r.fxSpread).toBeNull();
    expect(posted).toEqual([
      { type: 'TRANSFER_OUT', signedAmount: '-1000.00', ownerKind: 'SELLER' },
      { type: 'TRANSFER_IN', signedAmount: '1300.00', ownerKind: 'SELLER' },
    ]);
    expect(books).toEqual(['-1000.00', '1000.00']);
  });

  it('into rupees: credited what it was worth to their wallet; the bank’s gap is realised FX', async () => {
    // ৳2,000 held at an average ₹0.75: worth ₹1,500 to their wallet. The
    // bank gave ₹1,480. A rupee holding is its own book, so they are held
    // ₹1,500 and the ₹20 is ours to cover.
    const { svc, posted, books } = make(Currency.BDT, Currency.INR, '2000', {
      inrPerUnit: '0.75',
    });
    const r = await svc.transfer({
      ...BASE,
      amountOut: '2000',
      amountIn: '1480',
      sellerId: 'seller-a',
    });
    expect(r.creditedToSeller).toBe('1500.00');
    expect(r.fxSpread).toBe('-20.00');
    expect(posted).toEqual([
      { type: 'TRANSFER_OUT', signedAmount: '-2000.00', ownerKind: 'SELLER' },
      { type: 'TRANSFER_IN', signedAmount: '1500.00', ownerKind: 'SELLER' },
      { type: 'FX_SPREAD', signedAmount: '-20.00', ownerKind: 'CAPITAL' },
    ]);
    expect(books[0]).toBe('-1500.00');
  });

  it('takes the seller’s wallet lock before the reconcile lock', async () => {
    const { svc, locks } = make(Currency.INR, Currency.INR);
    await svc.transfer({ ...BASE, amountOut: '100', amountIn: '100', sellerId: 'seller-a' });
    expect(locks).toEqual([AdvisoryLock.WALLET, AdvisoryLock.BANK_RECONCILE]);
  });
});

describe('BankTransferService — a retried request is recorded once', () => {
  const PRIOR: PriorTransfer = {
    id: 't0',
    fromAccountId: 'from',
    toAccountId: 'to',
    amountOut: D('300'),
    amountIn: D('295'),
    currencyOut: Currency.INR,
    currencyIn: Currency.INR,
    sellerId: null,
    quotedRate: null,
    achievedRate: D('0.983333'),
    entries: [
      { type: 'TRANSFER_OUT', signedAmount: D('-300') },
      { type: 'TRANSFER_IN', signedAmount: D('300') },
      { type: 'EXPENSE', signedAmount: D('-5') },
    ],
  };
  const KEY = '7f3a2c1e-5b6d-4e8f-9a0b-1c2d3e4f5a6b';

  it('the same key returns the transfer already recorded, and moves nothing', async () => {
    const { svc, posted, created } = make(Currency.INR, Currency.INR, '0', { prior: PRIOR });
    const r = await svc.transfer({
      ...BASE,
      amountOut: '300',
      amountIn: '295',
      idempotencyKey: KEY,
    });
    expect(r).toEqual({
      transferId: 't0',
      achievedRate: '0.983333',
      fxSpread: null,
      bankCharge: '5.00',
      creditedToSeller: '300.00',
    });
    expect(posted).toHaveLength(0);
    expect(created).toHaveLength(0);
  });

  it('refuses the same key sent with a DIFFERENT transfer', async () => {
    const { svc, posted } = make(Currency.INR, Currency.INR, '0', { prior: PRIOR });
    await expect(
      svc.transfer({ ...BASE, amountOut: '300', amountIn: '290', idempotencyKey: KEY }),
    ).rejects.toMatchObject({ response: { code: 'IDEMPOTENCY_KEY_REUSED' } });
    expect(posted).toHaveLength(0);
  });

  it('stores the key on the transfer it records', async () => {
    const { svc, created } = make(Currency.INR, Currency.INR);
    await svc.transfer({ ...BASE, amountOut: '300', amountIn: '300', idempotencyKey: KEY });
    expect(created[0]).toMatchObject({ idempotencyKey: KEY });
  });
});

describe('BankTransferService — the quoted rate is a promise', () => {
  it('credits the seller at the QUOTED rate and keeps the upside', async () => {
    const { svc, posted, books } = make(Currency.INR, Currency.BDT);
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
    // The ৳1,300 are worth to their wallet what left: ₹1,000.
    expect(books.slice(0, 2)).toEqual(['-1000.00', '1000.00']);
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
