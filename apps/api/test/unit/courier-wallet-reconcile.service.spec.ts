import { CourierRechargeMatch, Prisma } from '@skydrop/db';
import { CourierWalletReconcileService } from '../../src/modules/courier-portal/services/courier-wallet-reconcile.service';
// jest hoists `jest.mock` above the imports, so this binding IS the fake
// class below; its statics are how each case sets the portal up.
import { WalletRechargesPage } from '../../src/modules/courier-portal/pages/wallet-recharges.page';

/**
 * The nightly check that every rupee in the courier's wallet came out of
 * one of ours, and that every rupee that left ours arrived in theirs.
 *
 * The portal read is faked at the PAGE boundary — these cases are about
 * what the service concludes, not about Chromium.
 */
jest.mock('../../src/modules/courier-portal/pages/wallet-recharges.page', () => {
  // Declared INSIDE the factory: jest hoists this call above every
  // binding in the file, so anything it closes over would not exist yet.
  class FakeWalletRechargesPage {
    static balance: unknown = {
      balanceInr: '50000.00',
      totalCreditInr: null,
      totalDebitInr: null,
    };
    static recharges: unknown[] = [];
    static fail: Error | null = null;

    async readBalance(): Promise<unknown> {
      if (FakeWalletRechargesPage.fail !== null) throw FakeWalletRechargesPage.fail;
      return FakeWalletRechargesPage.balance;
    }

    async listRecharges(): Promise<unknown> {
      return FakeWalletRechargesPage.recharges;
    }
  }
  return { WalletRechargesPage: FakeWalletRechargesPage };
});

const Portal = WalletRechargesPage as unknown as {
  balance: { balanceInr: string; totalCreditInr: string | null; totalDebitInr: string | null };
  recharges: Array<Record<string, unknown>>;
  fail: Error | null;
};

interface Ctx {
  svc: CourierWalletReconcileService;
  raise: jest.Mock;
  bankFindFirst: jest.Mock;
  bankFindMany: jest.Mock;
  rechargeUpdate: jest.Mock;
  resolveByKey: jest.Mock;
}

function make(opts: { accounts?: number; ourEntryInr?: string } = {}): Ctx {
  // The fake's statics survive between cases, so every one starts from
  // the same portal — a leaked balance from the case above is a failure
  // nobody can read.
  Portal.fail = null;
  Portal.balance = { balanceInr: '50000.00', totalCreditInr: null, totalDebitInr: null };
  Portal.recharges = [];

  const raise = jest.fn(async (_i: Record<string, unknown>) => ({ id: 'i-1', isNew: true }));
  const resolveByKey = jest.fn(async (_k: string, _n: string) => 1);
  const bankFindFirst = jest.fn(async () => null as unknown);
  const bankFindMany = jest.fn(async () => [] as unknown[]);
  const bankFindUnique = jest.fn(async () => ({
    signedAmount: new Prisma.Decimal(opts.ourEntryInr ?? '-20000.00'),
  }));
  const rechargeUpdate = jest.fn(async () => ({}));

  const prisma = {
    client: {
      courierAccount: {
        findMany: jest.fn(async () =>
          Array.from({ length: opts.accounts ?? 1 }, (_, i) => ({
            id: `ca-${i + 1}`,
            label: `Delhivery ${i + 1}`,
          })),
        ),
      },
      courierWalletRecharge: {
        findUnique: jest.fn(async () => null),
        upsert: jest.fn(async ({ create }: { create: Record<string, unknown> }) => ({
          id: 'rc-1',
          bankEntryId: null,
          matchState: CourierRechargeMatch.UNRECORDED,
          amountInr: create.amountInr,
        })),
        update: rechargeUpdate,
      },
      bankEntry: { findFirst: bankFindFirst, findMany: bankFindMany, findUnique: bankFindUnique },
      courierWalletBalance: { create: jest.fn(async () => ({})) },
      systemSetting: { findUnique: jest.fn(async () => null) },
    },
  };

  const session = { page: jest.fn(async () => ({ close: jest.fn(async () => undefined) })) };
  const svc = new CourierWalletReconcileService(
    prisma as never,
    session as never,
    {
      raise,
      resolveByKey,
    } as never,
  );
  return { svc, raise, bankFindFirst, bankFindMany, rechargeUpdate, resolveByKey };
}

const RECHARGE = {
  externalTxnId: 'MRC1',
  bankTxnRef: 'UTR9',
  amountInr: '20000.00',
  status: 'Success',
  occurredAt: new Date('2026-09-01T00:00:00Z'),
};

describe('CourierWalletReconcileService', () => {
  it('matches on the BANK’s reference — never on amount and date', async () => {
    // Two ₹20,000 top-ups on the same morning would be paired
    // arbitrarily by amount, and BOTH reported reconciled: a clean
    // report over a real gap, which is worse than no match at all.
    const { svc, bankFindFirst } = make();
    Portal.recharges = [RECHARGE];
    await svc.reconcile();
    const where = bankFindFirst.mock.calls[0]?.[0]?.where as Record<string, unknown>;
    expect(where.reference).toBe('UTR9');
    expect(where).not.toHaveProperty('signedAmount');
    // And only an entry nothing has already claimed.
    expect(where.courierRecharge).toEqual({ is: null });
  });

  it('raises HIGH when their recharge has nothing of ours behind it', async () => {
    const { svc, raise } = make();
    Portal.recharges = [RECHARGE];
    await svc.reconcile();
    const issue = raise.mock.calls.find((c) =>
      String((c[0] as { dedupeKey: string }).dedupeKey).startsWith('courier-recharge-unrecorded'),
    )?.[0] as { severity: string; dedupeKey: string };
    expect(issue.severity).toBe('HIGH');
    // Keyed on the recharge, not the moment — a nightly re-read must
    // bump one issue rather than open thirty.
    expect(issue.dedupeKey).toBe('courier-recharge-unrecorded:ca-1:MRC1');
  });

  it('MATCHES when our entry and their recharge agree', async () => {
    const ctx = make();
    ctx.bankFindFirst.mockResolvedValue({ id: 'be-1' });
    Portal.recharges = [RECHARGE];
    await ctx.svc.reconcile();
    expect(ctx.rechargeUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          bankEntryId: 'be-1',
          matchState: CourierRechargeMatch.MATCHED,
        }),
      }),
    );
    expect(
      ctx.raise.mock.calls.filter((c) =>
        String((c[0] as { dedupeKey: string }).dedupeKey).startsWith('courier-recharge-'),
      ),
    ).toHaveLength(0);
  });

  it('raises CRITICAL when the two sides disagree on the amount', async () => {
    // Ours says ₹19,500 left; theirs says ₹20,000 arrived. Money went
    // somewhere between the account and the wallet, and it is compared
    // on MAGNITUDE because the bank side is negative by construction.
    const ctx = make({ ourEntryInr: '-19500.00' });
    ctx.bankFindFirst.mockResolvedValue({ id: 'be-1' });
    Portal.recharges = [RECHARGE];
    await ctx.svc.reconcile();

    const issue = ctx.raise.mock.calls.find((c) =>
      String((c[0] as { dedupeKey: string }).dedupeKey).startsWith('courier-recharge-mismatch'),
    )?.[0] as { severity: string; metadata: { oursInr: string; theirsInr: string } };
    expect(issue.severity).toBe('CRITICAL');
    expect(issue.metadata.oursInr).toBe('19500.00');
    expect(issue.metadata.theirsInr).toBe('20000.00');
    // Still linked — the link is what lets somebody see the two rows
    // side by side; the state is what says they do not agree.
    expect(ctx.rechargeUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ matchState: CourierRechargeMatch.AMOUNT_MISMATCH }),
      }),
    );
  });

  it('checks for money that left and never arrived ONCE, not once per account', async () => {
    // It is a question about OUR ledger — a bank entry does not say
    // which wallet it funded — so asking it inside the per-account loop
    // would ask it N times over the same rows.
    const { svc, bankFindMany } = make({ accounts: 3 });
    Portal.recharges = [];
    await svc.reconcile();
    expect(bankFindMany).toHaveBeenCalledTimes(1);
  });

  it('still checks it when EVERY account’s portal read failed', async () => {
    // "Money left and nothing on their side matches it" is exactly the
    // finding that must not depend on the portal being reachable.
    const { svc, bankFindMany, raise } = make({ accounts: 2 });
    Portal.fail = new Error('login bounced');
    const out = await svc.reconcile();
    expect(bankFindMany).toHaveBeenCalledTimes(1);
    // And each account's failure is its own issue, not one aborting run.
    expect(
      raise.mock.calls.filter((c) =>
        String((c[0] as { dedupeKey: string }).dedupeKey).startsWith(
          'courier-wallet-reconcile-down',
        ),
      ),
    ).toHaveLength(2);
    expect(out.accounts).toBe(2);
  });

  it('one account failing does not cost the others their check', async () => {
    const { svc } = make({ accounts: 2 });
    Portal.fail = null;
    Portal.recharges = [RECHARGE];
    const out = await svc.reconcile();
    expect(out.rechargesSeen).toBe(2);
  });

  /**
   * The export we downloaded against the figure their own page states
   * for the same window.
   *
   * Two independent readings of one ledger, so a shortfall in the file
   * means rows are missing from it. This REPLACED a check that asserted
   * `credit − debit == balance` and raised CRITICAL when it did not: the
   * reasoning was right and the premise was wrong, because their totals
   * are for the selected window while the balance is point-in-time. It
   * could never pass, and fired nightly on a healthy account saying
   * nothing else there could be trusted.
   */
  function totalsIssue(
    ctx: ReturnType<typeof make>,
  ): { severity: string; metadata: Record<string, string> } | undefined {
    return ctx.raise.mock.calls.find((c) =>
      String((c[0] as { dedupeKey: string }).dedupeKey).startsWith(
        'courier-wallet-totals-disagree',
      ),
    )?.[0] as { severity: string; metadata: Record<string, string> } | undefined;
  }

  it('raises when the export sums BELOW what their page says was charged', async () => {
    const ctx = make();
    Portal.recharges = [];
    Portal.balance = {
      balanceInr: '50000.00',
      totalCreditInr: '100000.00',
      totalDebitInr: '30000.00',
    };
    await ctx.svc.reconcile('delhivery', new Map([['ca-1', '25000.00']]));
    const issue = totalsIssue(ctx);
    expect(issue?.severity).toBe('HIGH');
    expect(issue?.metadata['differenceInr']).toBe('5000.00');
  });

  it('a rounded paisa is NOT a missing row', async () => {
    // Their page rounds for display and the file does not; every real
    // capture differs by exactly this much.
    const ctx = make();
    Portal.recharges = [];
    Portal.balance = {
      balanceInr: '50000.00',
      totalCreditInr: '100000.00',
      totalDebitInr: '133782.35',
    };
    await ctx.svc.reconcile('delhivery', new Map([['ca-1', '133782.36']]));
    expect(totalsIssue(ctx)).toBeUndefined();
  });

  it('says NOTHING when there was no export to compare against', async () => {
    // A reconcile run on its own has no file. A missing input is not a
    // finding, and raising on it would be the old check's mistake in a
    // new costume.
    const ctx = make();
    Portal.recharges = [];
    Portal.balance = {
      balanceInr: '50000.00',
      totalCreditInr: '100000.00',
      totalDebitInr: '30000.00',
    };
    await ctx.svc.reconcile();
    expect(totalsIssue(ctx)).toBeUndefined();
  });

  it('does NOT compare the balance against the windowed totals', async () => {
    // The old check. `100000 − 30000 = 70000 ≠ 50000` and that is
    // entirely normal: the totals cover a date window, the balance is
    // now. Nothing should be raised on that arithmetic ever again.
    const ctx = make();
    Portal.recharges = [];
    Portal.balance = {
      balanceInr: '50000.00',
      totalCreditInr: '100000.00',
      totalDebitInr: '30000.00',
    };
    await ctx.svc.reconcile('delhivery', new Map([['ca-1', '30000.00']]));
    expect(totalsIssue(ctx)).toBeUndefined();
  });

  it('clears the low-balance warning once it has been topped up', async () => {
    // An issue that can only ever open is one people stop reading.
    const ctx = make();
    Portal.recharges = [];
    Portal.balance = { balanceInr: '50000.00', totalCreditInr: null, totalDebitInr: null };
    await ctx.svc.reconcile();
    expect(ctx.resolveByKey).toHaveBeenCalledWith(
      'courier-wallet-low:ca-1',
      expect.stringContaining('50000.00'),
    );
  });

  it('raises HIGH when the wallet is running out', async () => {
    const ctx = make();
    Portal.recharges = [];
    Portal.balance = { balanceInr: '900.00', totalCreditInr: null, totalDebitInr: null };
    await ctx.svc.reconcile();
    const issue = ctx.raise.mock.calls.find((c) =>
      String((c[0] as { dedupeKey: string }).dedupeKey).startsWith('courier-wallet-low'),
    )?.[0] as { severity: string };
    expect(issue.severity).toBe('HIGH');
  });
});

describe('a late failure does not erase what already succeeded', () => {
  it('keeps the recharge counts when the balance check throws', async () => {
    // The per-account catch reports "nothing is checking that money
    // leaving our bank reaches their wallet". Said after the matching
    // has just run, that is false — and it is the sentence somebody
    // would act on.
    const ctx = make();
    Portal.recharges = [RECHARGE];
    ctx.resolveByKey.mockRejectedValue(new Error('issue store down'));
    const out = await ctx.svc.reconcile();
    expect(out.rechargesSeen).toBe(1);
    expect(
      ctx.raise.mock.calls.filter((c) =>
        String((c[0] as { dedupeKey: string }).dedupeKey).startsWith(
          'courier-wallet-reconcile-down',
        ),
      ),
    ).toHaveLength(0);
  });
});
