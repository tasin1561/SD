import { ForbiddenException } from '@nestjs/common';
import { Currency, Prisma, WithdrawalRequestedBy, WithdrawalRequestStatus } from '@skydrop/db';
import { WithdrawalRequestService } from '../../src/modules/seller-wallet-withdrawal/services/withdrawal-request.service';
import type { SellerRestrictionService } from '../../src/modules/seller-restriction/services/seller-restriction.service';
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
    /** null / '' ⇒ the seller has no bank details on file. */
    bankAccountNumber?: string | null;
    /** Simulate a seller placed on hold by an admin. */
    restricted?: boolean;
    /** Sum of PENDING requests already raised. */
    pendingWithdrawals?: string;
    /** Simulate another admin resolving the request first — the guarded
     *  claim then matches 0 rows. */
    claimLoses?: boolean;
    /** The promise made to the seller, in hours. */
    slaHours?: number;
    /** How many pending requests are past it. */
    breachedCount?: number;
    /** What is in the seller's wallet, for the list's balance column. */
    sellerBalance?: string;
    /** When the longest-waiting pending request was raised. */
    oldestPendingAt?: Date;
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
  // Money already asked for is held out of what is available — the
  // guard subtracts PENDING requests so the same rupees cannot be
  // requested twice.
  const aggregate = jest.fn<Promise<AnyArgs>, [AnyArgs]>(async () => ({
    _sum: { amountRequested: new Prisma.Decimal(opts.pendingWithdrawals ?? '0') },
    // The admin queue also counts how many are past their SLA. Shared
    // mock, two callers: the create path reads only the sum.
    _count: { _all: opts.breachedCount ?? 0 },
  }));
  // Oldest pending, for the "waiting longest" figure.
  const findFirst = jest.fn<Promise<AnyArgs | null>, [AnyArgs]>(async () =>
    opts.oldestPendingAt === undefined ? null : { createdAt: opts.oldestPendingAt },
  );
  const withdrawalRequest = {
    create,
    findMany,
    findFirst,
    count,
    findUnique,
    update,
    updateMany,
    findUniqueOrThrow,
    aggregate,
  };
  // The create path now runs its limit checks, its balance read and the
  // insert inside ONE transaction holding the seller's wallet lock —
  // otherwise two concurrent submissions each see the state before the
  // other and both pass. `$executeRaw` stands in for that lock; a mocked
  // Prisma has no locking to exercise, which is exactly why the property
  // itself is proven in wallet-concurrency.e2e-spec against a real
  // database rather than here.
  const executeRaw = jest.fn(async () => 1);
  // Somewhere to pay it to. The create path refuses a request from a
  // seller with no bank details on file — an operator would pick it up,
  // have no account to wire to, and it would sit in the queue while the
  // seller waited.
  const sellerFindUnique = jest.fn<Promise<AnyArgs | null>, [AnyArgs]>(async () => ({
    bankAccountNumber:
      opts.bankAccountNumber === undefined ? '2303101640001' : opts.bankAccountNumber,
  }));
  const seller = { findUnique: sellerFindUnique };
  const txClient = { withdrawalRequest, seller, $executeRaw: executeRaw };
  const client = {
    withdrawalRequest,
    seller,
    // The SLA we told the seller to expect. Read globally rather than
    // per seller: the key carries no `sellerOverridable`, so there is
    // no per-seller answer.
    systemSetting: {
      findUnique: jest.fn(async () => ({ valueInt: opts.slaHours ?? 48 })),
    },
    // The wallet balance shown beside each request. Read once for the
    // whole page from the MAINTAINED table, which applyEntry writes in
    // the same transaction as the entry (WAL-7).
    sellerWalletBalance: {
      findMany: jest.fn(async () =>
        opts.sellerBalance === undefined
          ? []
          : [{ sellerId: 'seller-1', balance: new Prisma.Decimal(opts.sellerBalance) }],
      ),
    },
    remittance: { findUnique: remittanceFindUnique },
    $transaction: <T>(fn: (tx: unknown) => Promise<T>): Promise<T> => fn(txClient),
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
    // Not on hold, unless a case says otherwise. A restricted seller is
    // covered in seller-restriction.service.spec.
    {
      assertAllowed: jest.fn(async () => {
        if (opts.restricted === true) {
          throw new ForbiddenException({ code: 'SELLER_RESTRICTED', message: 'on hold' });
        }
      }),
    } as unknown as SellerRestrictionService,
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
    aggregate,
    prismaClient: client,
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

  it('refuses a seller with no bank details on file', async () => {
    // A withdrawal request with nowhere to send it is a promise nobody can
    // keep. Refused on the SERVER, not merely hidden in the UI: the
    // nightly auto-sweep raises requests through this same path with no
    // screen in front of it.
    const { svc, create } = makeService({ bankAccountNumber: null });
    await expect(
      svc.create('seller-1', 'user-1', { currency: Currency.INR, amount: '1000.00' }),
    ).rejects.toMatchObject({ response: { code: 'NO_BANK_ACCOUNT_ON_FILE' } });
    expect(create).not.toHaveBeenCalled();
  });

  it('treats a blank bank account as absent', async () => {
    const { svc } = makeService({ bankAccountNumber: '   ' });
    await expect(
      svc.create('seller-1', 'user-1', { currency: Currency.INR, amount: '1000.00' }),
    ).rejects.toMatchObject({ response: { code: 'NO_BANK_ACCOUNT_ON_FILE' } });
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
    const { svc, claim, auditLog } = makeService({
      existingRequest: makeRow({ status: 'APPROVED' }),
    });
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

  it('refuses to pay a request nobody approved', async () => {
    // Paying straight from PENDING skipped the one moment where the
    // balance is re-checked against what the seller is about to be
    // sent. Two steps, in order.
    const { svc, claim } = makeService({ existingRequest: makeRow({ status: 'PENDING' }) });
    await expect(svc.markPaid('wr-1', 'staff-1', 'rem-1')).rejects.toMatchObject({
      response: { code: 'WITHDRAWAL_REQUEST_NOT_APPROVED' },
    });
    expect(claim).not.toHaveBeenCalled();
  });

  it('404 REMITTANCE_NOT_FOUND when the linked remittance does not exist', async () => {
    const { svc, claim } = makeService({
      existingRequest: makeRow({ status: 'APPROVED' }),
      remittance: null,
    });
    await expect(svc.markPaid('wr-1', 'staff-1', 'missing-rem')).rejects.toMatchObject({
      response: { code: 'REMITTANCE_NOT_FOUND' },
    });
    expect(claim).not.toHaveBeenCalled();
  });

  it('rejects REMITTANCE_SELLER_MISMATCH when the remittance belongs to a different seller', async () => {
    const { svc, claim } = makeService({
      existingRequest: makeRow({ status: 'APPROVED' }),
      remittance: { id: 'rem-1', sellerId: 'seller-OTHER' },
    });
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
    const { svc } = makeService({
      existingRequest: makeRow({ status: 'APPROVED' }),
      claimLoses: true,
    });
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

/**
 * `wallet.withdrawal_sla_hours` has existed since the wallet shipped,
 * seeded at 48 and documented DISPLAY ONLY: the seller is told "within
 * 48 hours" and nothing measured whether it happened. A request could
 * sit past its own SLA indefinitely with no screen saying so — the
 * silent half of "asked for, never paid".
 */
describe('the withdrawal queue measures the promise it makes', () => {
  const HOURS = (h: number): Date => new Date(Date.now() - h * 3_600_000);

  it('orders the PENDING queue oldest FIRST', async () => {
    const { svc, findMany } = makeService();
    await svc.listForAdmin({ status: 'PENDING' as never });
    // Newest-first is right for history and wrong for work: it buries
    // the request that has waited longest at the bottom of the list.
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: { createdAt: 'asc' } }),
    );
  });

  it('keeps history newest first', async () => {
    const { svc, findMany } = makeService();
    await svc.listForAdmin({ status: 'PAID' as never });
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: { createdAt: 'desc' } }),
    );
  });

  it('reports the SLA and what has breached it', async () => {
    const { svc } = makeService({
      slaHours: 48,
      breachedCount: 3,
      pendingWithdrawals: '7500.00',
      oldestPendingAt: HOURS(100),
    });
    const out = await svc.listForAdmin({});
    expect(out.slaHours).toBe(48);
    expect(out.breachedCount).toBe(3);
    expect(out.breachedInr).toBe('7500.00');
    expect(out.oldestPendingHours).toBe(100);
  });

  it('counts breaches across EVERY matching row, not the page', async () => {
    const { svc, aggregate } = makeService({ slaHours: 48 });
    await svc.listForAdmin({ page: 2, pageSize: 10 });
    // A queue two pages long hides its oldest entries exactly when it
    // matters most, so the count must not be of what is displayed.
    const args = aggregate.mock.calls[0]?.[0] as AnyArgs;
    // Both unpaid states: someone approved and unpaid is still waiting,
    // and counting only PENDING would let the queue be cleared by
    // approving everything.
    expect(args['where']).toEqual(
      expect.objectContaining({
        status: { in: ['PENDING', 'APPROVED'] },
        createdAt: expect.anything(),
      }),
    );
    expect(args).not.toHaveProperty('skip');
  });

  it('says nothing is waiting when nothing is', async () => {
    const { svc } = makeService({ breachedCount: 0 });
    const out = await svc.listForAdmin({});
    expect(out.oldestPendingHours).toBeNull();
    expect(out.breachedCount).toBe(0);
  });

  it('falls back to 48 hours when the setting is missing rather than reporting no SLA', async () => {
    // An absent setting must not read as "no promise was made" — every
    // pending request would then look fine forever.
    const { svc, prismaClient } = makeService();
    (prismaClient.systemSetting.findUnique as jest.Mock).mockResolvedValueOnce(null);
    const out = await svc.listForAdmin({});
    expect(out.slaHours).toBe(48);
  });
});

/**
 * APPROVED existed in the enum from the start and nothing ever wrote
 * it, so a seller's request had exactly two answers: paid, or refused.
 * The decision and the payment are different acts — often different
 * people, often a day apart — and this is the first of them.
 */
describe('WithdrawalRequestService.approve', () => {
  it('moves a PENDING request to APPROVED and audits it', async () => {
    const { svc, claim, auditLog } = makeService({
      existingRequest: makeRow({ status: 'PENDING' }),
      balance: '5000',
    });
    await svc.approve('wr-1', 'staff-1');
    expect(claim).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: 'PENDING' }),
        data: expect.objectContaining({ status: 'APPROVED' }),
      }),
    );
    expect(auditLog.mock.calls[0]?.[0]?.['action']).toBe('staff.withdrawal_request.approved');
  });

  it('re-checks the balance NOW, not as it was when the request was raised', async () => {
    // Everything between the request and this moment can lower it —
    // order charges, a return fee, freight. Approving on the old number
    // promises money that is no longer there, and by then the seller
    // has been told yes.
    const { svc } = makeService({
      existingRequest: makeRow({ status: 'PENDING', amountRequested: new Prisma.Decimal('4000') }),
      balance: '1000',
    });
    await expect(svc.approve('wr-1', 'staff-1')).rejects.toMatchObject({
      response: { code: 'WITHDRAWAL_BALANCE_NO_LONGER_COVERS' },
    });
  });

  it('refuses anything that is not pending', async () => {
    const { svc } = makeService({ existingRequest: makeRow({ status: 'PAID' }) });
    await expect(svc.approve('wr-1', 'staff-1')).rejects.toMatchObject({
      response: { code: 'WITHDRAWAL_REQUEST_NOT_PENDING' },
    });
  });

  it('loses gracefully when another admin decided first', async () => {
    // The status read is outside any transaction, so two admins
    // approving at once would both write and the second would overwrite
    // the first's decision.
    const { svc } = makeService({
      existingRequest: makeRow({ status: 'PENDING' }),
      balance: '5000',
      claimLoses: true,
    });
    await expect(svc.approve('wr-1', 'staff-1')).rejects.toMatchObject({
      response: { code: 'WITHDRAWAL_REQUEST_ALREADY_MOVED' },
    });
  });

  it('an APPROVED request is still WAITING — approving does not clear the queue', async () => {
    // Counting only PENDING would let the queue be emptied by approving
    // everything, while the seller waits exactly as long for money that
    // has not moved.
    const { svc, findMany } = makeService();
    findMany.mockResolvedValueOnce([makeRow({ status: 'APPROVED' })]);
    const out = await svc.listForAdmin({});
    expect(out.items[0]?.waitingHours).not.toBeNull();
  });

  it('an APPROVED request can still be rejected — the money never moved', async () => {
    const { svc, claim } = makeService({ existingRequest: makeRow({ status: 'APPROVED' }) });
    await svc.reject('wr-1', 'staff-1', 'Bank details bounced');
    expect(claim).toHaveBeenCalled();
  });
});

/**
 * The wallet balance beside the amount asked for.
 *
 * Approving is a judgement about whether the wallet covers it, and
 * sending an operator to another page for that is how a request gets
 * approved on a balance nobody looked at.
 */
describe('the admin queue shows what the money comes out of', () => {
  it('attaches each seller’s balance to their request', async () => {
    const { svc, findMany } = makeService({ sellerBalance: '7500.00' });
    findMany.mockResolvedValueOnce([makeRow({ sellerId: 'seller-1' })]);
    const out = await svc.listForAdmin({});
    expect(out.items[0]?.sellerBalanceInr).toBe('7500.00');
  });

  it('reads every seller on the page in ONE query, not one per row', async () => {
    // A query per line is fine on a page with one row and wrong on the
    // screen somebody scrolls when deciding what to pay.
    const { svc, findMany, prismaClient } = makeService({ sellerBalance: '100.00' });
    findMany.mockResolvedValueOnce([
      makeRow({ id: 'a', sellerId: 'seller-1' }),
      makeRow({ id: 'b', sellerId: 'seller-1' }),
      makeRow({ id: 'c', sellerId: 'seller-2' }),
    ]);
    await svc.listForAdmin({});
    const balanceQuery = prismaClient.sellerWalletBalance.findMany as jest.Mock;
    expect(balanceQuery).toHaveBeenCalledTimes(1);
    // De-duplicated: two rows for one seller ask for that seller once.
    const where = (balanceQuery.mock.calls[0]?.[0] as AnyArgs)['where'] as AnyArgs;
    expect((where['sellerId'] as AnyArgs)['in']).toEqual(['seller-1', 'seller-2']);
  });

  it('shows zero rather than nothing for a seller with no balance row yet', async () => {
    // A seller who has never been credited has no row. That is a
    // balance of zero, not an unknown.
    const { svc, findMany } = makeService({});
    findMany.mockResolvedValueOnce([makeRow({ sellerId: 'seller-9' })]);
    const out = await svc.listForAdmin({});
    expect(out.items[0]?.sellerBalanceInr).toBe('0.00');
  });
});
