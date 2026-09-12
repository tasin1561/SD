import { Currency, Prisma } from '@skydrop/db';
import { AdvisoryLock } from '../../src/common/db/advisory-lock';
import { RemittanceService } from '../../src/modules/admin-remittance/services/remittance.service';
import { SellerCashAttributionService } from '../../src/modules/treasury/services/seller-cash-attribution.service';

/**
 * The cash side of paying a seller out.
 *
 * WHOSE money left is decided per account: the seller's part is at most
 * what they hold in the account the payout left, the rest is ours, and an
 * equal value of their money wherever else it sits becomes ours in its
 * place. The ordinary BD payout is exactly that shape — their COD sits in
 * rupees at HDFC and they are paid in taka from Tasin — so refusing it
 * would block every payout, and posting it all as theirs drove the taka
 * account's held-for-them figure negative.
 */

const D = (v: string): Prisma.Decimal => new Prisma.Decimal(v);

type Post = {
  accountId: string;
  type: string;
  signedAmount: Prisma.Decimal;
  amountCurrency: string;
  owner: { kind: string; sellerId?: string };
  expenseCategoryId?: string;
};

function makeSut(opts: {
  /** What the seller holds in the paying account. */
  heldHere: string;
  /** Everything they hold, across accounts. */
  holdings?: Array<{ accountId: string; currency: Currency; amount: string }>;
  /** The latest accepted top-up into the paying account: [arrived, credited]. */
  topup?: [string, string];
  fx?: { fromCurrency: Currency; rate: string };
}) {
  const events: string[] = [];
  const posts: Post[] = [];
  const bank = {
    post: jest.fn(async (input: Post) => {
      posts.push(input);
      return { id: `be-${posts.length}` };
    }),
    ownerBalance: jest.fn(async () => D(opts.heldHere)),
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
          _sum: { signedAmount: D(h.amount) },
        })),
      ),
    },
    walletTopupRequest: {
      findFirst: jest.fn(async () =>
        opts.topup === undefined
          ? null
          : { amount: D(opts.topup[0]), walletEntry: { amount: D(opts.topup[1]) } },
      ),
    },
    fxRate: {
      findFirst: jest.fn(async () =>
        opts.fx === undefined
          ? null
          : { fromCurrency: opts.fx.fromCurrency, rate: D(opts.fx.rate) },
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
  return { svc, posts, events, audit };
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

const record = (svc: RemittanceService, input: Record<string, unknown>): Promise<unknown> =>
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
      heldHere: '0',
      holdings: [{ accountId: 'hdfc', currency: Currency.INR, amount: '511.40' }],
      fx: { fromCurrency: Currency.INR, rate: '1.25' },
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
      heldHere: '0',
      holdings: [{ accountId: 'hdfc', currency: Currency.INR, amount: '511.40' }],
      fx: { fromCurrency: Currency.INR, rate: '1.25' },
    });
    await record(svc, BD_PAYOUT);
    expect(summary(posts)).toEqual([
      ['tasin', 'CAPITAL', '-625.00', 'BDT', 'SELLER_WITHDRAWAL'],
      ['hdfc', 'SELLER', '-500.00', 'INR', 'RECLASSIFICATION'],
      ['hdfc', 'CAPITAL', '500.00', 'INR', 'RECLASSIFICATION'],
    ]);
  });

  it('paid from where their money is: all of it is theirs, nothing else moves', async () => {
    const { svc, posts } = makeSut({
      heldHere: '1000',
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

  it('never takes more of their value than the wallet debit — a better bank rate is ours', async () => {
    // Their taka was credited at ₹0.80, so ₹500 of theirs is ৳625. The
    // bank gave 1.30: ৳650 went out, and the extra ৳25 is ours to pay.
    const { svc, posts } = makeSut({
      heldHere: '1000',
      holdings: [{ accountId: 'tasin', currency: Currency.BDT, amount: '1000' }],
      topup: ['1000', '800'],
    });
    await record(svc, { ...BD_PAYOUT, amount: 650, fxRateSnapshot: 1.3 });
    expect(summary(posts)).toEqual([
      ['tasin', 'SELLER', '-625.00', 'BDT', 'SELLER_WITHDRAWAL'],
      ['tasin', 'CAPITAL', '-25.00', 'BDT', 'SELLER_WITHDRAWAL'],
    ]);
  });

  it('books a bank fee as OUR expense in bank_charges — the seller still gets it all', async () => {
    const { svc, posts, audit } = makeSut({
      heldHere: '0',
      holdings: [{ accountId: 'hdfc', currency: Currency.INR, amount: '511.40' }],
      fx: { fromCurrency: Currency.INR, rate: '1.25' },
    });
    await record(svc, { ...BD_PAYOUT, bankFee: 15 });
    const fee = posts.at(-1);
    expect(fee && summary([fee])).toEqual([['tasin', 'CAPITAL', '-15.00', 'BDT', 'EXPENSE']]);
    expect(fee?.expenseCategoryId).toBe('cat-bank');
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({ changes: expect.objectContaining({ bankFee: '15.00' }) }),
    );
  });
});
