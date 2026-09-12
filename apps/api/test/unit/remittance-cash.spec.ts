import { Currency, Prisma } from '@skydrop/db';
import { AdvisoryLock } from '../../src/common/db/advisory-lock';
import { RemittanceService } from '../../src/modules/admin-remittance/services/remittance.service';
import { SellerCashAttributionService } from '../../src/modules/treasury/services/seller-cash-attribution.service';

/**
 * The cash side of paying a seller out.
 *
 * The wallet falls by the rupees debited (S), so what the book holds for
 * the seller falls by exactly S: from the paying account at their AVERAGE
 * rate there, the rest from their money elsewhere (which becomes ours, the
 * taka for it leaving as ours at the payout's own rate), and any gap
 * between the taka that actually left and what those parts were worth is
 * REALISED FX, ours, linked to the payout. The ordinary BD payout — COD in
 * rupees at HDFC, paid in taka from Tasin — is exactly the second shape.
 */

const D = (v: string): Prisma.Decimal => new Prisma.Decimal(v);

type Post = {
  accountId: string;
  type: string;
  signedAmount: Prisma.Decimal;
  amountCurrency: string;
  owner: { kind: string; sellerId?: string };
  expenseCategoryId?: string;
  inrBookValue?: Prisma.Decimal | null;
  remittanceId?: string | null;
};

function makeSut(opts: {
  /** The seller's money in the PAYING account: units, and their rupee book value. */
  here?: { units: string; book: string };
  /** Their money everywhere (what their money elsewhere becoming ours draws on). */
  holdings?: Array<{ accountId: string; currency: Currency; amount: string; book?: string }>;
  /** A remittance already recorded under the request's idempotency key. */
  prior?: Record<string, unknown> | null;
}) {
  const events: string[] = [];
  const posts: Post[] = [];
  const bank = {
    post: jest.fn(async (input: Post) => {
      posts.push(input);
      return { id: `be-${posts.length}` };
    }),
    ownerBalance: jest.fn(async () => D(opts.here?.units ?? '0')),
    sellerBook: jest.fn(async () => ({
      units: D(opts.here?.units ?? '0'),
      book: D(opts.here?.book ?? '0'),
    })),
  };
  const tx = {
    $executeRaw: jest.fn(async (_s: TemplateStringsArray, ns: number) => {
      events.push(`lock:${ns}`);
      return 1;
    }),
    remittance: { create: jest.fn(async () => ({ id: 'rem-1' })) },
    expenseCategory: { upsert: jest.fn(async () => ({ id: 'cat-bank' })) },
    bankEntry: {
      groupBy: jest.fn(async () =>
        (opts.holdings ?? []).map((h) => ({
          accountId: h.accountId,
          currency: h.currency,
          _sum: {
            signedAmount: D(h.amount),
            inrBookValue: h.book === undefined ? null : D(h.book),
          },
        })),
      ),
    },
  };
  const wallet = {
    balanceLive: jest.fn(async () => {
      events.push('read');
      return D('100000');
    }),
    applyEntry: jest.fn(async () => ({ id: 'we-1' })),
    recomputeCacheAfterCommit: jest.fn(async () => undefined),
  };
  const audit = { log: jest.fn(async (_e: Record<string, unknown>) => 'a1') };
  const svc = Object.create(RemittanceService.prototype) as RemittanceService;
  Object.assign(svc, {
    prisma: {
      client: {
        seller: {
          findUnique: jest.fn(async () => ({
            id: 's1',
            bankName: 'BRAC Bank',
            bankBranchName: 'Gulshan',
            bankAccountName: 'Menev Store',
            bankAccountNumber: '1501100000001',
            bankRoutingNumber: null,
            bankSwiftCode: null,
          })),
        },
        withdrawalRequest: { findMany: jest.fn(async () => []) },
        remittance: { findUnique: jest.fn(async () => opts.prior ?? null) },
        $transaction: async (fn: (t: unknown) => unknown) => fn(tx),
      },
    },
    audit,
    wallet,
    bank,
    withdrawals: { markPaid: jest.fn() },
    issues: { raise: jest.fn() },
    // The real attribution, writing through the same ledger stand-in, so
    // the reattribution pairs land in `posts` beside the payout.
    attribution: new SellerCashAttributionService(bank as never),
    logger: { log: jest.fn(), warn: jest.fn() },
  });
  return { svc, posts, events, audit, wallet };
}

// ₹500 paid out as ৳625 (1.25) from our taka account.
const BD_PAYOUT = {
  sellerId: 's1',
  currency: Currency.BDT,
  amount: 625,
  sourceCurrency: Currency.INR,
  sourceAmount: 500,
  fxRateSnapshot: 1.25,
  bankReference: 'BRAC-TRF-0001',
  paidFromAccountId: 'tasin',
  paidAt: '2026-09-12T10:00:00.000Z',
};

const record = (
  svc: RemittanceService,
  input: Record<string, unknown>,
): Promise<{ id: string; replayed: boolean }> =>
  svc.create(input as never, { staffId: 'staff-1' }, {
    ipAddress: '127.0.0.1',
    userAgent: 'jest',
  } as never);

const summary = (posts: Post[]): string[][] =>
  posts.map((p) => [
    p.accountId,
    p.owner.kind,
    p.signedAmount.toFixed(2),
    p.amountCurrency,
    p.type,
  ]);

describe('recording a remittance — whose cash left', () => {
  it('takes the wallet lock BEFORE it reads the balance it guards', async () => {
    const { svc, events } = makeSut({
      holdings: [{ accountId: 'hdfc', currency: Currency.INR, amount: '511.40' }],
    });
    await record(svc, BD_PAYOUT);
    expect(events[0]).toBe(`lock:${AdvisoryLock.WALLET}`);
    expect(events.indexOf(`lock:${AdvisoryLock.WALLET}`)).toBeLessThan(events.indexOf('read'));
  });

  it('paid in taka while their money is in rupees: the taka is ours, their rupees become ours', async () => {
    // Menev on production: ₹511.40 held at HDFC, nothing at Tasin. The
    // ৳625 leaves as capital; ₹500 of their HDFC money is reclassified to
    // capital in its place, so we still hold them ₹11.40 — their wallet.
    const { svc, posts } = makeSut({
      holdings: [{ accountId: 'hdfc', currency: Currency.INR, amount: '511.40' }],
    });
    await record(svc, BD_PAYOUT);
    expect(summary(posts)).toEqual([
      ['tasin', 'CAPITAL', '-625.00', 'BDT', 'SELLER_WITHDRAWAL'],
      ['hdfc', 'SELLER', '-500.00', 'INR', 'RECLASSIFICATION'],
      ['hdfc', 'CAPITAL', '500.00', 'INR', 'RECLASSIFICATION'],
    ]);
  });

  it('a paying account with no rate of its own is no obstacle — the payout’s own rate values it', async () => {
    // It used to need the seller's top-up rate (or today's) for the paying
    // account; with neither, the seller's rupees elsewhere were never made
    // ours and stayed "theirs" for a wallet that had just been paid out.
    // The payout states its rate, which is all the arithmetic needs.
    const { svc, posts } = makeSut({
      holdings: [{ accountId: 'hdfc', currency: Currency.INR, amount: '800' }],
    });
    await record(svc, BD_PAYOUT);
    const moved = posts.filter((p) => p.type === 'RECLASSIFICATION' && p.owner.kind === 'SELLER');
    expect(moved.map((p) => p.signedAmount.toFixed(2))).toEqual(['-500.00']);
  });

  it('paid from where their money is: all of it is theirs, nothing else moves', async () => {
    const { svc, posts } = makeSut({
      here: { units: '1000', book: '1000' },
      holdings: [{ accountId: 'hdfc', currency: Currency.INR, amount: '1000' }],
    });
    await record(svc, {
      ...BD_PAYOUT,
      currency: Currency.INR,
      amount: 500,
      fxRateSnapshot: 1,
      paidFromAccountId: 'hdfc',
    });
    expect(summary(posts)).toEqual([['hdfc', 'SELLER', '-500.00', 'INR', 'SELLER_WITHDRAWAL']]);
  });

  it('their taka leaves at their AVERAGE rate — a worse bank rate is realised FX, ours', async () => {
    // ৳1,000 worth ₹800 to their wallet: ₹500 of it is ৳625. The bank gave
    // 1.30, so ৳650 went out — the ৳25 more is a realised FX loss of ours,
    // linked to the payout so the P&L converts it at the payout's rate.
    const { svc, posts } = makeSut({ here: { units: '1000', book: '800' } });
    await record(svc, { ...BD_PAYOUT, amount: 650, fxRateSnapshot: 1.3 });
    expect(summary(posts)).toEqual([
      ['tasin', 'SELLER', '-625.00', 'BDT', 'SELLER_WITHDRAWAL'],
      ['tasin', 'CAPITAL', '-25.00', 'BDT', 'FX_SPREAD'],
    ]);
    expect(posts[0]?.inrBookValue?.toFixed(2)).toBe('-500.00');
    expect(posts.every((p) => p.remittanceId === 'rem-1')).toBe(true);
  });

  it('a better bank rate is realised FX too — in our favour', async () => {
    // ₹500 of their taka is ৳625; the bank needed only ৳600 at 1.20.
    const { svc, posts } = makeSut({ here: { units: '1000', book: '800' } });
    await record(svc, { ...BD_PAYOUT, amount: 600, fxRateSnapshot: 1.2 });
    expect(summary(posts)).toEqual([
      ['tasin', 'SELLER', '-625.00', 'BDT', 'SELLER_WITHDRAWAL'],
      ['tasin', 'CAPITAL', '25.00', 'BDT', 'FX_SPREAD'],
    ]);
  });

  it('two top-ups at different rates are paid out at their AVERAGE, and a full payout leaves nothing', async () => {
    // ৳1,000 at ₹0.70 and ৳1,000 at ₹0.80: ৳2,000 worth ₹1,500. Paying out
    // ₹1,500 takes every unit and every rupee of book. Valued at the last
    // top-up's rate (₹0.80) it took ৳1,875 and left ৳125 "theirs".
    const { svc, posts } = makeSut({ here: { units: '2000', book: '1500' } });
    await record(svc, {
      ...BD_PAYOUT,
      sourceAmount: 1500,
      amount: 2000,
      fxRateSnapshot: 1.333333,
    });
    expect(summary(posts)).toEqual([['tasin', 'SELLER', '-2000.00', 'BDT', 'SELLER_WITHDRAWAL']]);
    expect(posts[0]?.inrBookValue?.toFixed(2)).toBe('-1500.00');
  });

  it('what the paying account cannot cover comes from their money elsewhere', async () => {
    // ৳500 here worth ₹400; the other ₹100 is their rupees at HDFC, and
    // the ৳125 it buys at the payout's 1.25 leaves as ours.
    const { svc, posts } = makeSut({
      here: { units: '500', book: '400' },
      holdings: [
        { accountId: 'tasin', currency: Currency.BDT, amount: '500', book: '400' },
        { accountId: 'hdfc', currency: Currency.INR, amount: '1000' },
      ],
    });
    await record(svc, BD_PAYOUT);
    expect(summary(posts)).toEqual([
      ['tasin', 'SELLER', '-500.00', 'BDT', 'SELLER_WITHDRAWAL'],
      ['tasin', 'CAPITAL', '-125.00', 'BDT', 'SELLER_WITHDRAWAL'],
      ['hdfc', 'SELLER', '-100.00', 'INR', 'RECLASSIFICATION'],
      ['hdfc', 'CAPITAL', '100.00', 'INR', 'RECLASSIFICATION'],
    ]);
  });

  it('books a bank fee as OUR expense in bank_charges — the seller still gets it all', async () => {
    const { svc, posts, audit } = makeSut({
      holdings: [{ accountId: 'hdfc', currency: Currency.INR, amount: '511.40' }],
    });
    await record(svc, { ...BD_PAYOUT, bankFee: 15 });
    const fee = posts.at(-1);
    expect(fee && summary([fee])).toEqual([['tasin', 'CAPITAL', '-15.00', 'BDT', 'EXPENSE']]);
    expect(fee?.expenseCategoryId).toBe('cat-bank');
    expect(fee?.remittanceId).toBe('rem-1');
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({ changes: expect.objectContaining({ bankFee: '15.00' }) }),
    );
  });
});

describe('recording a remittance — a retried request pays once', () => {
  const KEY = '0b1c2d3e-4f5a-4b6c-8d7e-9f0a1b2c3d4e';
  const PRIOR = {
    id: 'rem-0',
    sellerId: 's1',
    currency: Currency.BDT,
    amount: D('625'),
    sourceAmount: D('500'),
    paidFromAccountId: 'tasin',
  };

  it('the same key returns the remittance already recorded and debits nothing', async () => {
    const { svc, posts, wallet } = makeSut({ prior: PRIOR });
    const r = await record(svc, { ...BD_PAYOUT, idempotencyKey: KEY });
    expect(r).toEqual({ id: 'rem-0', replayed: true });
    expect(posts).toHaveLength(0);
    expect(wallet.applyEntry).not.toHaveBeenCalled();
  });

  it('refuses the same key sent with a DIFFERENT payout', async () => {
    const { svc, wallet } = makeSut({ prior: { ...PRIOR, amount: D('600') } });
    await expect(record(svc, { ...BD_PAYOUT, idempotencyKey: KEY })).rejects.toMatchObject({
      response: { code: 'IDEMPOTENCY_KEY_REUSED' },
    });
    expect(wallet.applyEntry).not.toHaveBeenCalled();
  });

  it('a fresh payout says it is not a replay', async () => {
    const { svc } = makeSut({
      holdings: [{ accountId: 'hdfc', currency: Currency.INR, amount: '511.40' }],
    });
    await expect(record(svc, { ...BD_PAYOUT, idempotencyKey: KEY })).resolves.toEqual({
      id: 'rem-1',
      replayed: false,
    });
  });
});
