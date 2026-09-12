import { Currency, Prisma, TopupRequestStatus } from '@skydrop/db';
import { WalletTopupService } from '../../src/modules/wallet-topup/services/wallet-topup.service';

/**
 * A top-up that lands while the seller owes us.
 *
 * Charges taken while a seller held nothing wrote no bank entry — the
 * debt was a receivable (TRE-8). The top-up is what settles it, so that
 * part of the cash is OURS; posting all of it as theirs held them money
 * their wallet does not show. The part is moved in the account and the
 * currency it landed in.
 */

const D = (v: string): Prisma.Decimal => new Prisma.Decimal(v);

function makeSut(opts: { currency: Currency; amount: string; credited: string; repaid: string }) {
  const tx = {
    // The wallet and account locks are advisory locks (pg_advisory_xact_lock).
    $executeRaw: jest.fn(async () => 1),
    walletTopupRequest: {
      updateMany: jest.fn(async () => ({ count: 1 })),
      update: jest.fn(async () => ({ id: 'topup-1', walletEntryId: 'we-1' })),
    },
  };
  const prisma = {
    client: { $transaction: jest.fn(async (fn: (t: unknown) => unknown) => fn(tx)) },
  };
  const wallet = {
    applyEntry: jest.fn(async () => ({ id: 'we-1', runningBalanceAfter: D('0') })),
    recomputeCacheAfterCommit: jest.fn(async () => undefined),
  };
  const fx = { convert: jest.fn(async () => ({ amount: opts.credited })) };
  const bank = { post: jest.fn(async () => ({ id: 'be-1' })) };
  const repayDebt = jest.fn(async () => undefined);
  const attribution = {
    debtSplit: jest.fn(async (_t: unknown, _s: string, amount: Prisma.Decimal) => ({
      toCapital: D(opts.repaid),
      toSeller: amount.sub(D(opts.repaid)),
    })),
    repayDebt,
  };
  const svc = new WalletTopupService(
    prisma as never,
    {} as never,
    { log: jest.fn(async () => 'a1') } as never,
    wallet as never,
    fx as never,
    {} as never,
    bank as never,
    attribution as never,
  );
  const existing = {
    id: 'topup-1',
    sellerId: 'seller-1',
    status: TopupRequestStatus.PENDING,
    currency: opts.currency,
    amount: D(opts.amount),
    bankAccountId: opts.currency === Currency.INR ? 'hdfc' : 'tasin',
    transactionRef: 'UTR-1',
    bankLabel: 'Our account',
  };
  jest
    .spyOn(svc as unknown as { requireRequest: () => Promise<unknown> }, 'requireRequest')
    .mockResolvedValue(existing);
  jest
    .spyOn(svc as unknown as { notifySeller: () => Promise<void> }, 'notifySeller')
    .mockResolvedValue(undefined);
  jest.spyOn(svc as unknown as { toView: () => unknown }, 'toView').mockReturnValue({});
  return { svc, repayDebt, bank };
}

describe('WalletTopupService.accept — a top-up repays what the seller owed', () => {
  it('moves the repaid part of a rupee top-up to capital, in that account', async () => {
    const { svc, repayDebt } = makeSut({
      currency: Currency.INR,
      amount: '5000',
      credited: '5000',
      repaid: '3000',
    });
    await svc.accept('topup-1', 'staff-1', null);
    expect(repayDebt).toHaveBeenCalledTimes(1);
    const input = (repayDebt.mock.calls[0] as unknown as [unknown, AnyInput])[1];
    expect(input).toMatchObject({ sellerId: 'seller-1', accountId: 'hdfc', currency: 'INR' });
    expect(input.amount.toString()).toBe('3000');
  });

  it('repays a taka top-up in taka, in proportion to the rupee credit', async () => {
    // ৳5,000 credited as ₹4,000; ₹1,000 of it repays a debt — a quarter,
    // so ৳1,250 of the cash is ours.
    const { svc, repayDebt } = makeSut({
      currency: Currency.BDT,
      amount: '5000',
      credited: '4000',
      repaid: '1000',
    });
    await svc.accept('topup-1', 'staff-1', null);
    const input = (repayDebt.mock.calls[0] as unknown as [unknown, AnyInput])[1];
    expect(input).toMatchObject({ accountId: 'tasin', currency: 'BDT' });
    expect(input.amount.toFixed(2)).toBe('1250.00');
  });

  it('moves nothing when the seller owed nothing', async () => {
    const { svc, repayDebt, bank } = makeSut({
      currency: Currency.INR,
      amount: '5000',
      credited: '5000',
      repaid: '0',
    });
    await svc.accept('topup-1', 'staff-1', null);
    expect(repayDebt).not.toHaveBeenCalled();
    // The top-up itself is still posted, whole, as theirs.
    expect(bank.post).toHaveBeenCalledTimes(1);
  });
});

interface AnyInput {
  sellerId: string;
  accountId: string;
  currency: string;
  amount: Prisma.Decimal;
}
