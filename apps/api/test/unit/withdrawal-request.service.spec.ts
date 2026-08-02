import { Currency, Prisma, WithdrawalRequestedBy, WithdrawalRequestStatus } from '@skydrop/db';
import { WithdrawalRequestService } from '../../src/modules/seller-wallet-withdrawal/services/withdrawal-request.service';
import type { PrismaService } from '../../src/infrastructure/prisma/prisma.service';
import type { AuditLogService } from '../../src/modules/auth-common/services/audit-log.service';
import type { WalletService } from '../../src/modules/seller-wallet/services/wallet.service';
import type { SettingsResolverService } from '../../src/modules/settings/services/settings-resolver.service';

type AnyArgs = Record<string, unknown>;

function makeRow(overrides: Partial<AnyArgs> = {}): AnyArgs {
  return {
    id: 'wr-1',
    sellerId: 'seller-1',
    currency: Currency.INR,
    amountRequested: new Prisma.Decimal('1000'),
    status: WithdrawalRequestStatus.PENDING,
    requestedBy: WithdrawalRequestedBy.SELLER,
    linkedRemittanceId: null,
    rejectionReason: null,
    note: null,
    createdAt: new Date(),
    resolvedAt: null,
    ...overrides,
  };
}

function makeService(
  opts: {
    balance?: string;
    minThreshold?: string;
    maxPerDay?: number;
    maxPerMonth?: number;
    minBalance?: string;
    todayCount?: number;
    existingRequest?: AnyArgs | null;
    remittance?: AnyArgs | null;
    /** Simulate another admin resolving the request first — the guarded
     *  claim then matches 0 rows. */
    claimLoses?: boolean;
  } = {},
) {
  const create = jest.fn<Promise<AnyArgs>, [AnyArgs]>(async (a) => makeRow(a.data as AnyArgs));
  const findMany = jest.fn<Promise<AnyArgs[]>, [AnyArgs]>(async () => []);
  const count = jest.fn<Promise<number>, [AnyArgs]>(async () => opts.todayCount ?? 0);
  const findUnique = jest.fn<Promise<AnyArgs | null>, [AnyArgs]>(async () =>
    opts.existingRequest === undefined ? makeRow() : opts.existingRequest,
  );
  const update = jest.fn<Promise<AnyArgs>, [AnyArgs]>(async (a) => ({
    ...makeRow(),
    ...(a.data as AnyArgs),
  }));
  // The guarded claim: `count: 0` is Postgres reporting that the request
  // was already resolved by someone else between our read and our write.
  let lastClaimData: AnyArgs = {};
  const updateMany = jest.fn<Promise<{ count: number }>, [AnyArgs]>(async (a) => {
    lastClaimData = a.data as AnyArgs;
    return { count: opts.claimLoses ? 0 : 1 };
  });
  const findUniqueOrThrow = jest.fn<Promise<AnyArgs>, [AnyArgs]>(async () => ({
    ...makeRow(),
    ...lastClaimData,
  }));
  const remittanceFindUnique = jest.fn<Promise<AnyArgs | null>, [AnyArgs]>(async () =>
    opts.remittance === undefined ? { id: 'rem-1', sellerId: 'seller-1' } : opts.remittance,
  );
  const client = {
    withdrawalRequest: {
      create,
      findMany,
      count,
      findUnique,
      update,
      updateMany,
      findUniqueOrThrow,
    },
    remittance: { findUnique: remittanceFindUnique },
  };
  const prisma = { client } as unknown as PrismaService;

  const auditLog = jest.fn<Promise<string | null>, [AnyArgs]>(async () => 'a1');
  const audit = { log: auditLog };

  const balanceLive = jest.fn(async () => new Prisma.Decimal(opts.balance ?? '5000'));
  const wallet = { balanceLive };

  const resolve = jest.fn(async (_sellerId: string, key: string) => {
    if (key === 'wallet.withdrawal_min_threshold_inr') {
      return {
        key,
        valueType: 'DECIMAL',
        value: opts.minThreshold ?? '500.00',
        source: 'SYSTEM_DEFAULT' as const,
      };
    }
    if (key === 'wallet.withdrawal_max_per_day') {
      return {
        key,
        valueType: 'INT',
        value: opts.maxPerDay ?? 1,
        source: 'SYSTEM_DEFAULT' as const,
      };
    }
    if (key === 'wallet.withdrawal_max_per_month') {
      return {
        key,
        valueType: 'INT',
        value: opts.maxPerMonth ?? 20,
        source: 'SYSTEM_DEFAULT' as const,
      };
    }
    if (key === 'wallet.minimum_balance_inr') {
      // The floor a seller may not withdraw below. Zero by default, so
      // the pre-existing cases below still describe the same behaviour.
      return {
        key,
        valueType: 'DECIMAL',
        value: opts.minBalance ?? '0.00',
        source: 'SYSTEM_DEFAULT' as const,
      };
    }
    throw new Error(`unexpected key ${key}`);
  });
  const settings = { resolve };

  const svc = new WithdrawalRequestService(
    prisma,
    audit as unknown as AuditLogService,
    wallet as unknown as WalletService,
    settings as unknown as SettingsResolverService,
  );
  return {
    svc,
    create,
    findMany,
    count,
    findUnique,
    update,
    claim: updateMany,
    auditLog,
    balanceLive,
    resolve,
  };
}

describe('WithdrawalRequestService.create', () => {
  it('creates a PENDING request + audits', async () => {
    const { svc, create, auditLog } = makeService();
    const result = await svc.create('seller-1', 'user-1', {
      currency: Currency.INR,
      amount: '1000.00',
    });
    expect(result.status).toBe(WithdrawalRequestStatus.PENDING);
    expect(create).toHaveBeenCalledTimes(1);
    expect(auditLog.mock.calls[0]![0]!.action).toBe('seller.withdrawal_request.created');
  });

  it('rejects INVALID_AMOUNT for zero/negative amounts', async () => {
    const { svc, create } = makeService();
    await expect(
      svc.create('seller-1', 'user-1', { currency: Currency.INR, amount: '0' }),
    ).rejects.toMatchObject({ response: { code: 'INVALID_AMOUNT' } });
    expect(create).not.toHaveBeenCalled();
  });

  it('rejects BELOW_MIN_THRESHOLD for INR under the setting', async () => {
    const { svc, create } = makeService({ minThreshold: '500.00' });
    await expect(
      svc.create('seller-1', 'user-1', { currency: Currency.INR, amount: '100.00' }),
    ).rejects.toMatchObject({ response: { code: 'BELOW_MIN_THRESHOLD' } });
    expect(create).not.toHaveBeenCalled();
  });

  it('skips the min-threshold check for BDT', async () => {
    const { svc, create } = makeService({ minThreshold: '500.00', balance: '5000' });
    const result = await svc.create('seller-1', 'user-1', {
      currency: Currency.BDT,
      amount: '100.00',
    });
    expect(result).toBeDefined();
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('rejects WITHDRAWAL_DAILY_LIMIT_REACHED at the per-seller max', async () => {
    const { svc, create } = makeService({ maxPerDay: 1, todayCount: 1 });
    await expect(
      svc.create('seller-1', 'user-1', { currency: Currency.INR, amount: '1000.00' }),
    ).rejects.toMatchObject({ response: { code: 'WITHDRAWAL_DAILY_LIMIT_REACHED' } });
    expect(create).not.toHaveBeenCalled();
  });

  it('refuses when the wallet is short', async () => {
    const { svc, create } = makeService({ balance: '100' });
    await expect(
      svc.create('seller-1', 'user-1', { currency: Currency.INR, amount: '1000.00' }),
    ).rejects.toMatchObject({ response: { code: 'INSUFFICIENT_WITHDRAWABLE_BALANCE' } });
    expect(create).not.toHaveBeenCalled();
  });

  it('refuses to withdraw below the minimum balance, even with the money there', async () => {
    // ₹5,000 in the wallet but ₹4,000 must stay behind, so only ₹1,000
    // is withdrawable. This is what stands between us and an unpaid
    // delivery fee on a seller who ships prepaid: their wallet is the
    // only security we hold, and a floor is how a credit limit is
    // expressed here.
    const { svc, create } = makeService({ balance: '5000', minBalance: '4000.00' });
    await expect(
      svc.create('seller-1', 'user-1', { currency: Currency.INR, amount: '2000.00' }),
    ).rejects.toMatchObject({ response: { code: 'INSUFFICIENT_WITHDRAWABLE_BALANCE' } });
    expect(create).not.toHaveBeenCalled();

    // ...and the part below the floor still goes through.
    const ok = makeService({ balance: '5000', minBalance: '4000.00' });
    await expect(
      ok.svc.create('seller-1', 'user-1', { currency: Currency.INR, amount: '900.00' }),
    ).resolves.toBeDefined();
  });

  it('refuses past the monthly request count, not just the daily one', async () => {
    const { svc, create } = makeService({ maxPerDay: 50, maxPerMonth: 2, todayCount: 2 });
    await expect(
      svc.create('seller-1', 'user-1', { currency: Currency.INR, amount: '1000.00' }),
    ).rejects.toMatchObject({ response: { code: 'WITHDRAWAL_MONTHLY_LIMIT_REACHED' } });
    expect(create).not.toHaveBeenCalled();
  });

  it('withdrawableBalance is balance minus the floor, clamped at zero', async () => {
    // Three callers need this same number — the guard, whatever the
    // seller is shown as available, and the auto-withdrawal sweep, which
    // withdraws exactly it. Three independent subtractions would
    // eventually disagree, and the symptom would be a sweep asking for
    // money the guard then refuses.
    const { svc } = makeService({ balance: '1000', minBalance: '4000.00' });
    expect((await svc.withdrawableBalance('seller-1', Currency.INR)).toFixed(2)).toBe('0.00');
  });
});

describe('WithdrawalRequestService.markPaid', () => {
  it('links the remittance and marks PAID + audits', async () => {
    const { svc, claim, auditLog } = makeService();
    const result = await svc.markPaid('wr-1', 'staff-1', 'rem-1');
    expect(result.status).toBe(WithdrawalRequestStatus.PAID);
    expect(claim).toHaveBeenCalledWith(
      expect.objectContaining({
        // Guarded on "still unresolved" — this is what stops two admins
        // both writing and the last one silently detaching the other's
        // remittance from the request it paid.
        where: expect.objectContaining({ status: expect.anything() }),
        data: expect.objectContaining({
          status: WithdrawalRequestStatus.PAID,
          linkedRemittanceId: 'rem-1',
          resolvedByStaffId: 'staff-1',
        }),
      }),
    );
    expect(auditLog.mock.calls[0]![0]!.action).toBe('staff.withdrawal_request.paid');
  });

  it('404 when the request does not exist', async () => {
    const { svc } = makeService({ existingRequest: null });
    await expect(svc.markPaid('missing', 'staff-1', 'rem-1')).rejects.toMatchObject({
      response: { code: 'WITHDRAWAL_REQUEST_NOT_FOUND' },
    });
  });

  it('rejects WITHDRAWAL_REQUEST_ALREADY_RESOLVED when already PAID', async () => {
    const { svc, claim } = makeService({
      existingRequest: makeRow({ status: WithdrawalRequestStatus.PAID }),
    });
    await expect(svc.markPaid('wr-1', 'staff-1', 'rem-1')).rejects.toMatchObject({
      response: { code: 'WITHDRAWAL_REQUEST_ALREADY_RESOLVED' },
    });
    expect(claim).not.toHaveBeenCalled();
  });

  it('rejects WITHDRAWAL_REQUEST_ALREADY_RESOLVED when already REJECTED', async () => {
    const { svc } = makeService({
      existingRequest: makeRow({ status: WithdrawalRequestStatus.REJECTED }),
    });
    await expect(svc.markPaid('wr-1', 'staff-1', 'rem-1')).rejects.toMatchObject({
      response: { code: 'WITHDRAWAL_REQUEST_ALREADY_RESOLVED' },
    });
  });

  it('404 REMITTANCE_NOT_FOUND when the linked remittance does not exist', async () => {
    const { svc, claim } = makeService({ remittance: null });
    await expect(svc.markPaid('wr-1', 'staff-1', 'missing-rem')).rejects.toMatchObject({
      response: { code: 'REMITTANCE_NOT_FOUND' },
    });
    expect(claim).not.toHaveBeenCalled();
  });

  it('rejects REMITTANCE_SELLER_MISMATCH when the remittance belongs to a different seller', async () => {
    const { svc, claim } = makeService({ remittance: { id: 'rem-1', sellerId: 'seller-OTHER' } });
    await expect(svc.markPaid('wr-1', 'staff-1', 'rem-1')).rejects.toMatchObject({
      response: { code: 'REMITTANCE_SELLER_MISMATCH' },
    });
    expect(claim).not.toHaveBeenCalled();
  });
});

describe('WithdrawalRequestService.reject', () => {
  it('rejects the request + audits with the reason', async () => {
    const { svc, claim, auditLog } = makeService();
    const result = await svc.reject('wr-1', 'staff-1', 'insufficient documentation');
    expect(result.status).toBe(WithdrawalRequestStatus.REJECTED);
    expect(claim).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: expect.anything() }),
        data: expect.objectContaining({
          status: WithdrawalRequestStatus.REJECTED,
          rejectionReason: 'insufficient documentation',
        }),
      }),
    );
    expect(auditLog.mock.calls[0]![0]!.action).toBe('staff.withdrawal_request.rejected');
  });

  /**
   * The status check is a read outside any transaction. Without a guarded
   * claim two admins resolving the same request would both write, and the
   * last would win — quietly detaching the other's remittance from the
   * request it actually paid. No money is duplicated (the remittance moves
   * it, not this row), but a real bank transfer accounted to nothing is
   * its own kind of wrong.
   */
  it('a concurrent second resolver is refused rather than overwriting the first', async () => {
    const { svc } = makeService({ claimLoses: true });
    await expect(svc.markPaid('wr-1', 'staff-2', 'rem-2')).rejects.toMatchObject({
      response: { code: 'WITHDRAWAL_REQUEST_ALREADY_RESOLVED' },
    });
  });

  it('404 when the request does not exist', async () => {
    const { svc } = makeService({ existingRequest: null });
    await expect(svc.reject('missing', 'staff-1', 'reason')).rejects.toMatchObject({
      response: { code: 'WITHDRAWAL_REQUEST_NOT_FOUND' },
    });
  });

  it('rejects WITHDRAWAL_REQUEST_ALREADY_RESOLVED when already resolved', async () => {
    const { svc, claim } = makeService({
      existingRequest: makeRow({ status: WithdrawalRequestStatus.PAID }),
    });
    await expect(svc.reject('wr-1', 'staff-1', 'reason')).rejects.toMatchObject({
      response: { code: 'WITHDRAWAL_REQUEST_ALREADY_RESOLVED' },
    });
    expect(claim).not.toHaveBeenCalled();
  });
});

describe('WithdrawalRequestService.listForSeller / listForAdmin', () => {
  it('scopes listForSeller to the given seller', async () => {
    const { svc, findMany } = makeService();
    await svc.listForSeller('seller-1');
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { sellerId: 'seller-1' } }),
    );
  });

  it('listForAdmin applies optional sellerId/status filters + pagination', async () => {
    const { svc, findMany, count } = makeService();
    const result = await svc.listForAdmin({
      sellerId: 'seller-1',
      status: WithdrawalRequestStatus.PENDING,
      page: 2,
      pageSize: 10,
    });
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { sellerId: 'seller-1', status: WithdrawalRequestStatus.PENDING },
        skip: 10,
        take: 10,
      }),
    );
    expect(count).toHaveBeenCalled();
    expect(result.page).toBe(2);
    expect(result.pageSize).toBe(10);
  });

  it('listForAdmin with no filters queries an empty where clause', async () => {
    const { svc, findMany } = makeService();
    await svc.listForAdmin({});
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ where: {} }));
  });
});
