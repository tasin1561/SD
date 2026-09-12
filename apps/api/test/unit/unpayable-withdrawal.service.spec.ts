import {
  Currency,
  NotificationChannel,
  Prisma,
  SystemIssueKind,
  WithdrawalRequestStatus,
} from '@skydrop/db';
import {
  AUTO_REJECT_UNPAYABLE_KEY,
  UnpayableWithdrawalService,
  WITHDRAWAL_AUTO_REJECTED_TOPIC,
} from '../../src/modules/seller-wallet-withdrawal/services/unpayable-withdrawal.service';
import { AutoWithdrawalSweepService } from '../../src/modules/seller-wallet-withdrawal/services/auto-withdrawal-sweep.service';
import { WithdrawalRequestService } from '../../src/modules/seller-wallet-withdrawal/services/withdrawal-request.service';
import type { PrismaService } from '../../src/infrastructure/prisma/prisma.service';
import type { SettingsResolverService } from '../../src/modules/settings/services/settings-resolver.service';
import type { WalletService } from '../../src/modules/seller-wallet/services/wallet.service';
import type { AuditLogService } from '../../src/modules/auth-common/services/audit-log.service';
import type { SystemIssueService } from '../../src/modules/system-issues/services/system-issue.service';
import type { NotificationDispatchService } from '../../src/modules/notification-audience/services/notification-dispatch.service';
import type { SellerRestrictionService } from '../../src/modules/seller-restriction/services/seller-restriction.service';
import type { FxRateService } from '../../src/modules/fx/services/fx-rate.service';

type AnyArgs = Record<string, unknown>;
const D = (v: string): Prisma.Decimal => new Prisma.Decimal(v);

interface Req {
  id: string;
  sellerId: string;
  currency: Currency;
  amountRequested: Prisma.Decimal;
  status: WithdrawalRequestStatus;
}

/**
 * In-memory requests, a per-seller balance, and the REAL
 * `withdrawableBalance` arithmetic (floor 0) — so "its own amount is left
 * out, every other pending one counts" is exercised, not assumed.
 */
function world(opts: {
  requests: Req[];
  balance: Record<string, string>;
  enabled?: Record<string, boolean | 'throws'>;
  /** Simulate a person approving/deciding between our read and write. */
  claimLoses?: boolean;
}) {
  const reqs = opts.requests.map((r) => ({ ...r }));
  const lock = jest.fn(async () => 1);
  const updateMany = jest.fn(async (a: AnyArgs) => {
    const where = a.where as { id: string; status: WithdrawalRequestStatus };
    const row = reqs.find((r) => r.id === where.id && r.status === where.status);
    if (opts.claimLoses === true || row === undefined) return { count: 0 };
    Object.assign(row, a.data as AnyArgs);
    return { count: 1 };
  });
  const findUnique = jest.fn(
    async (a: AnyArgs) => reqs.find((r) => r.id === (a.where as { id: string }).id) ?? null,
  );
  const aggregate = jest.fn(async (a: AnyArgs) => {
    const w = a.where as {
      sellerId: string;
      status: WithdrawalRequestStatus | { in: WithdrawalRequestStatus[] };
      id?: { not: string };
    };
    const statuses = typeof w.status === 'string' ? [w.status] : w.status.in;
    const sum = reqs
      .filter(
        (r) =>
          r.sellerId === w.sellerId &&
          statuses.includes(r.status) &&
          (w.id === undefined || r.id !== w.id.not),
      )
      .reduce((s, r) => s.add(r.amountRequested), D('0'));
    return { _sum: { amountRequested: sum } };
  });
  const findMany = jest.fn(async (a: AnyArgs) => {
    const status = (a.where as { status: WithdrawalRequestStatus }).status;
    const rows = reqs.filter((r) => r.status === status);
    return (a.orderBy as AnyArgs | undefined) !== undefined ? [...rows].reverse() : rows;
  });
  const tx = {
    $executeRaw: lock,
    withdrawalRequest: { findUnique, updateMany, aggregate },
  };
  const client = {
    withdrawalRequest: { findMany, findUnique, updateMany, aggregate },
    systemIssue: { findMany: jest.fn(async () => [] as AnyArgs[]) },
    $transaction: jest.fn(async (fn: (t: unknown) => Promise<unknown>) => fn(tx)),
  };
  const prisma = { client } as unknown as PrismaService;
  const balanceLive = jest.fn(async (sellerId: string) => D(opts.balance[sellerId] ?? '0'));
  const wallet = { balanceLive } as unknown as WalletService;
  const settings = {
    resolve: jest.fn(async (sellerId: string, key: string) => {
      if (key === AUTO_REJECT_UNPAYABLE_KEY) {
        const v = opts.enabled?.[sellerId] ?? true;
        if (v === 'throws') throw new Error('settings down');
        return { value: v };
      }
      return { value: 0 }; // minimum balance
    }),
  } as unknown as SettingsResolverService;
  const withdrawals = new WithdrawalRequestService(
    prisma,
    {} as SellerRestrictionService,
    {} as AuditLogService,
    wallet,
    settings,
    {} as FxRateService,
  );
  const auditLog = jest.fn(async () => undefined);
  const raise = jest.fn(async () => ({ id: 'issue-1', isNew: true }));
  const resolveByKey = jest.fn(async () => 0);
  const dispatch = jest.fn(async () => ({
    groupId: 'g',
    recipients: 1,
    delivered: 1,
    skipped: 0,
    failures: 0,
  }));
  const svc = new UnpayableWithdrawalService(
    prisma,
    settings,
    wallet,
    withdrawals,
    { log: auditLog } as unknown as AuditLogService,
    { raise, resolveByKey } as unknown as SystemIssueService,
    { dispatch } as unknown as NotificationDispatchService,
  );
  return { svc, reqs, lock, updateMany, auditLog, raise, resolveByKey, dispatch, aggregate };
}

const pending = (id: string, sellerId: string, amount: string): Req => ({
  id,
  sellerId,
  currency: Currency.INR,
  amountRequested: D(amount),
  status: WithdrawalRequestStatus.PENDING,
});

describe('UnpayableWithdrawalService', () => {
  it('rejects the unpayable request (Menev: asked ₹2,946.40, wallet ₹111.40) and leaves a payable one', async () => {
    const w = world({
      requests: [pending('menev', 's-menev', '2946.40'), pending('ok', 's-ok', '500')],
      balance: { 's-menev': '111.40', 's-ok': '800' },
    });
    const res = await w.svc.sweep();
    expect(res.rejected).toBe(1);
    const menev = w.reqs.find((r) => r.id === 'menev') as unknown as AnyArgs;
    expect(menev.status).toBe(WithdrawalRequestStatus.REJECTED);
    expect(menev.resolvedByStaffId).toBeNull();
    expect(String(menev.rejectionReason)).toContain('Asked for ₹2946.40, only ₹111.40');
    expect(String(menev.rejectionReason)).toContain('A new request can be made');
    expect(w.reqs.find((r) => r.id === 'ok')?.status).toBe(WithdrawalRequestStatus.PENDING);
    // Decided under the wallet lock (WAL-7).
    expect(w.lock).toHaveBeenCalled();
  });

  it('a request is not blocked by its own amount; other pending requests still count', async () => {
    // ₹1,000 wallet, one ₹1,000 request: payable (its own amount excluded).
    const alone = world({ requests: [pending('a', 's1', '1000')], balance: { s1: '1000' } });
    expect((await alone.svc.sweep()).rejected).toBe(0);
    expect(alone.aggregate).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ id: { not: 'a' } }) }),
    );

    // Two of ₹800 against ₹1,000: the NEWER is rejected, the older then
    // re-judged against the freed balance and kept.
    const two = world({
      requests: [pending('older', 's1', '800'), pending('newer', 's1', '800')],
      balance: { s1: '1000' },
    });
    const res = await two.svc.sweep();
    expect(res.rejected).toBe(1);
    expect(two.reqs.find((r) => r.id === 'newer')?.status).toBe(WithdrawalRequestStatus.REJECTED);
    expect(two.reqs.find((r) => r.id === 'older')?.status).toBe(WithdrawalRequestStatus.PENDING);
  });

  it('rejects only what cannot be paid ON ITS OWN first — ₹500, an older ₹1,000 and a newer ₹100', async () => {
    // Newest-first alone judged the ₹100 with the ₹1,000 still held,
    // rejected it, then rejected the ₹1,000 too — while the ₹100 was
    // payable all along.
    const w = world({
      requests: [pending('older', 's1', '1000'), pending('newer', 's1', '100')],
      balance: { s1: '500' },
    });
    const res = await w.svc.sweep();
    expect(res.rejected).toBe(1);
    expect(w.reqs.find((r) => r.id === 'older')?.status).toBe(WithdrawalRequestStatus.REJECTED);
    expect(w.reqs.find((r) => r.id === 'newer')?.status).toBe(WithdrawalRequestStatus.PENDING);
  });

  it('an APPROVED request holds its money: a later request against it is rejected, and the approved one is not flagged', async () => {
    // ₹1,000 wallet, ₹900 approved. The approved money is spoken for, so
    // a ₹200 request cannot be paid even alone — and the approved one,
    // judged without counting ITSELF, is still covered.
    const approved: Req = {
      ...pending('ap', 's1', '900'),
      status: WithdrawalRequestStatus.APPROVED,
    };
    const w = world({
      requests: [approved, pending('late', 's1', '200')],
      balance: { s1: '1000' },
    });
    const res = await w.svc.sweep();
    expect(res.rejected).toBe(1);
    expect(res.flaggedApproved).toBe(0);
    expect(w.reqs.find((r) => r.id === 'late')?.status).toBe(WithdrawalRequestStatus.REJECTED);
    expect(w.reqs.find((r) => r.id === 'ap')?.status).toBe(WithdrawalRequestStatus.APPROVED);
    expect(w.raise).not.toHaveBeenCalled();
  });

  it('a newer PENDING request does not make an approved one look uncovered', async () => {
    const approved: Req = {
      ...pending('ap', 's1', '600'),
      status: WithdrawalRequestStatus.APPROVED,
    };
    const w = world({
      requests: [approved, pending('p', 's1', '300')],
      balance: { s1: '800' },
      enabled: { s1: false },
    });
    await w.svc.sweep();
    expect(w.raise).not.toHaveBeenCalled();
  });

  it('does nothing when the setting is off for that seller, or cannot be read', async () => {
    const w = world({
      requests: [pending('off', 's-off', '900'), pending('err', 's-err', '900')],
      balance: { 's-off': '10', 's-err': '10' },
      enabled: { 's-off': false, 's-err': 'throws' },
    });
    const res = await w.svc.sweep();
    expect(res.rejected).toBe(0);
    expect(res.failures).toBe(1);
    expect(w.updateMany).not.toHaveBeenCalled();
    expect(w.reqs.every((r) => r.status === WithdrawalRequestStatus.PENDING)).toBe(true);
  });

  it('the claim is guarded: a request approved concurrently is not rejected, nobody is told', async () => {
    const w = world({
      requests: [pending('r', 's1', '900')],
      balance: { s1: '10' },
      claimLoses: true,
    });
    const res = await w.svc.sweep();
    expect(res.rejected).toBe(0);
    expect(w.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'r', status: WithdrawalRequestStatus.PENDING } }),
    );
    expect(w.auditLog).not.toHaveBeenCalled();
    expect(w.dispatch).not.toHaveBeenCalled();
  });

  it('audits as the system and tells the seller in-app, once per request', async () => {
    const w = world({ requests: [pending('r', 's1', '900')], balance: { s1: '10' } });
    await w.svc.sweep();
    expect(w.auditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        actorType: 'SYSTEM',
        action: 'system.withdrawal_request.auto_rejected',
        entityId: 'r',
        severity: 'MEDIUM',
      }),
      expect.anything(),
    );
    expect(w.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        topic: WITHDRAWAL_AUTO_REJECTED_TOPIC,
        channels: [NotificationChannel.IN_APP],
        eventId: 'withdrawal_auto_rejected:r',
        audience: [{ kind: 'SELLER_PERMISSION', sellerId: 's1', permission: 'wallet.view' }],
      }),
    );
  });

  it('never rejects an APPROVED request — it raises it, and clears the flag once covered', async () => {
    const approved: Req = {
      ...pending('ap', 's1', '900'),
      status: WithdrawalRequestStatus.APPROVED,
    };
    const w = world({ requests: [approved], balance: { s1: '10' } });
    const res = await w.svc.sweep();
    expect(res.rejected).toBe(0);
    expect(res.flaggedApproved).toBe(1);
    expect(w.reqs[0]?.status).toBe(WithdrawalRequestStatus.APPROVED);
    expect(w.raise).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: SystemIssueKind.MONEY,
        dedupeKey: 'withdrawal-approved-uncovered:ap',
      }),
    );

    const covered = world({ requests: [approved], balance: { s1: '5000' } });
    await covered.svc.sweep();
    expect(covered.raise).not.toHaveBeenCalled();
    expect(covered.resolveByKey).toHaveBeenCalledWith(
      'withdrawal-approved-uncovered:ap',
      expect.any(String),
    );
  });
});

describe('after an automatic rejection, the auto-withdrawal sweep', () => {
  function sweepWith(withdrawable: string) {
    const createAuto = jest.fn(async () => ({}));
    const prisma = {
      client: {
        seller: {
          findMany: jest.fn(async () => [{ id: 's-menev', timezone: 'Asia/Dhaka' }]),
        },
        // The rejected request is from 2 Sep, outside the 20h dedupe window.
        withdrawalRequest: { findFirst: jest.fn(async () => null) },
      },
    } as unknown as PrismaService;
    const values: Record<string, unknown> = {
      'wallet.auto_withdraw_enabled': true,
      'wallet.auto_withdraw_hour_local': 10,
      'wallet.withdrawal_min_threshold_inr': 100,
      'wallet.auto_withdraw_keep_balance_inr': 0,
      'wallet.minimum_balance_inr': 0,
    };
    const settings = {
      resolve: jest.fn(async (_s: string, k: string) => ({ value: values[k] })),
    } as unknown as SettingsResolverService;
    const withdrawals = {
      withdrawableBalance: jest.fn(async () => D(withdrawable)),
      createAuto,
    } as unknown as WithdrawalRequestService;
    // 10:00 in Dhaka.
    const now = new Date('2026-09-13T04:00:00Z');
    return {
      run: () => new AutoWithdrawalSweepService(prisma, settings, withdrawals).sweep(now),
      createAuto,
    };
  }

  it('raises a fresh request for exactly what is withdrawable now', async () => {
    const s = sweepWith('111.40');
    await s.run();
    expect(s.createAuto).toHaveBeenCalledWith(
      's-menev',
      expect.objectContaining({ amount: '111.40' }),
    );
  });

  it('raises nothing when what is withdrawable is below the minimum — never an unpayable request', async () => {
    const s = sweepWith('40.00');
    await s.run();
    expect(s.createAuto).not.toHaveBeenCalled();
  });
});
