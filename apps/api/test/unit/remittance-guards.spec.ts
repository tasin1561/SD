import { Prisma } from '@skydrop/db';
import { RemittanceService } from '../../src/modules/admin-remittance/services/remittance.service';
import { AdvisoryLock } from '../../src/common/db/advisory-lock';
import type { CreateRemittanceDto } from '../../src/modules/admin-remittance/dto/create-remittance.dto';

/**
 * A payout's guards: the wallet balance is read UNDER the wallet lock
 * (WAL-7), the paying account must hold that seller's cash in its own
 * currency, and a bank fee is booked as our expense.
 */

const D = (v: string): Prisma.Decimal => new Prisma.Decimal(v);

type Post = {
  type: string;
  signedAmount: Prisma.Decimal;
  amountCurrency: string;
  owner: { kind: string; sellerId?: string };
  expenseCategoryId?: string | null;
};

function makeSut(opts: { balance?: string; heldHere?: string } = {}) {
  const events: string[] = [];
  const posts: Post[] = [];
  const tx = {
    $executeRaw: jest.fn(async (..._args: unknown[]) => {
      events.push(`lock:${String(_args[1])}`);
      return 1;
    }),
    remittance: { create: jest.fn(async () => ({ id: 'rem-1' })) },
    expenseCategory: { upsert: jest.fn(async () => ({ id: 'cat-bank' })) },
  };
  const prisma = {
    client: {
      seller: {
        findUnique: jest.fn(async () => ({
          id: 's-1',
          bankName: 'BRAC',
          bankBranchName: 'Gulshan',
          bankAccountName: 'Menev Store',
          bankAccountNumber: '1234',
          bankRoutingNumber: null,
          bankSwiftCode: null,
        })),
      },
      withdrawalRequest: { findMany: jest.fn(async () => []) },
      $transaction: async (fn: (t: unknown) => unknown) => fn(tx),
    },
  };
  const wallet = {
    balanceLive: jest.fn(async () => {
      events.push('balance');
      return D(opts.balance ?? '5000');
    }),
    applyEntry: jest.fn(async () => ({ id: 'we-1', runningBalanceAfter: D('0') })),
    recomputeCacheAfterCommit: jest.fn(async () => undefined),
  };
  const bank = {
    post: jest.fn(async (p: Post) => {
      posts.push(p);
      return { id: `be-${posts.length}` };
    }),
    ownerBalance: jest.fn(async () => {
      events.push('held');
      return D(opts.heldHere ?? '100000');
    }),
    holdingsForSeller: jest.fn(async () => [
      { accountId: 'hdfc', label: 'HDFC — COD receiving', currency: 'INR', amount: '5000.00' },
    ]),
  };
  const svc = new RemittanceService(
    prisma as never,
    { log: jest.fn(async () => 'a1') } as never,
    wallet as never,
    bank as never,
    { markPaid: jest.fn() } as never,
    { raise: jest.fn() } as never,
  );
  return { svc, events, posts, wallet, bank };
}

const INPUT: CreateRemittanceDto = {
  sellerId: 's-1',
  currency: 'BDT',
  amount: 1300,
  sourceCurrency: 'INR',
  sourceAmount: 1000,
  fxRateSnapshot: 1.3,
  bankReference: 'TRF-1',
  paidFromAccountId: 'tasin',
  paidAt: '2026-09-12T10:00:00.000Z',
} as CreateRemittanceDto;
const CTX = { ipAddress: null, userAgent: null } as never;

describe('RemittanceService.create — guards', () => {
  it('reads the wallet balance only after taking the wallet lock, inside the transaction', async () => {
    const { svc, events } = makeSut();
    await svc.create(INPUT, { staffId: 'staff-1' }, CTX);
    // The lock, THEN the read — a read before it is not a guard (WAL-7).
    expect(events.slice(0, 2)).toEqual([`lock:${AdvisoryLock.WALLET}`, 'balance']);
    // Then the seller's reconcile lock, then their holding in the account.
    expect(events.slice(2, 4)).toEqual([`lock:${AdvisoryLock.BANK_RECONCILE}`, 'held']);
  });

  it('refuses a payout from an account that does not hold that much of their cash', async () => {
    // The payout is their cash leaving THIS account. With ৳500 of theirs
    // here, ৳1,300 would leave the account holding −৳800 for them while
    // their ₹5,000 elsewhere stayed "theirs" after being paid.
    const { svc, wallet, posts } = makeSut({ heldHere: '500' });
    const err = await svc.create(INPUT, { staffId: 'staff-1' }, CTX).catch((e: unknown) => e);
    expect(err).toMatchObject({ response: { code: 'REMITTANCE_EXCEEDS_SELLER_HOLDING' } });
    const message = (err as { response: { message: string } }).response.message;
    expect(message).toContain('500.00 BDT');
    expect(message).toContain('HDFC — COD receiving 5000.00 INR');
    expect(wallet.applyEntry).not.toHaveBeenCalled();
    expect(posts).toHaveLength(0);
  });

  it('still refuses more than the wallet owes', async () => {
    const { svc } = makeSut({ balance: '900' });
    await expect(svc.create(INPUT, { staffId: 'staff-1' }, CTX)).rejects.toMatchObject({
      response: { code: 'INSUFFICIENT_WALLET_BALANCE' },
    });
  });

  it('books a bank fee as OUR expense under bank charges, in the account’s currency', async () => {
    const { svc, posts } = makeSut();
    await svc.create({ ...INPUT, bankFee: 25 }, { staffId: 'staff-1' }, CTX);
    expect(
      posts.map((p) => [p.type, p.signedAmount.toFixed(2), p.amountCurrency, p.owner.kind]),
    ).toEqual([
      ['SELLER_WITHDRAWAL', '-1300.00', 'BDT', 'SELLER'],
      ['EXPENSE', '-25.00', 'BDT', 'CAPITAL'],
    ]);
    expect(posts[1]?.expenseCategoryId).toBe('cat-bank');
  });

  it('books no fee when none is given', async () => {
    const { svc, posts } = makeSut();
    await svc.create(INPUT, { staffId: 'staff-1' }, CTX);
    expect(posts.map((p) => p.type)).toEqual(['SELLER_WITHDRAWAL']);
  });

  it('refuses a fee that is not positive', async () => {
    const { svc } = makeSut();
    await expect(
      svc.create({ ...INPUT, bankFee: 0 }, { staffId: 'staff-1' }, CTX),
    ).rejects.toMatchObject({ response: { code: 'REMITTANCE_BANK_FEE_INVALID' } });
  });
});
