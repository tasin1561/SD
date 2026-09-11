import type { PrismaService } from '../../src/infrastructure/prisma/prisma.service';
import type { AuditLogService } from '../../src/modules/auth-common/services/audit-log.service';
import type { SystemIssueService } from '../../src/modules/system-issues/services/system-issue.service';
import type { WalletImportService } from '../../src/modules/wallet-ledger/services/wallet-import.service';
import type { CourierWalletReconcileService } from '../../src/modules/courier-portal/services/courier-wallet-reconcile.service';
import {
  ShiprocketPortalChallengeError,
  type ShiprocketPortalHandle,
  type ShiprocketPortalSessionService,
} from '../../src/modules/courier-portal/services/shiprocket-portal-session.service';
import { ShiprocketWalletSyncService } from '../../src/modules/courier-portal/services/shiprocket-wallet-sync.service';

/**
 * The nightly Shiprocket wallet sync, with the browser replaced by the
 * rows it would have read. These cases are about what the night
 * CONCLUDES — the page object is tested against their real page.
 */
type Rows = {
  passbookRows: string[][];
  usable: string | null;
  rechargeRows: string[][];
  ledgerRows: string[][];
};

class TestSync extends ShiprocketWalletSyncService {
  rows: Rows | Error = { passbookRows: [], usable: null, rechargeRows: [], ledgerRows: [] };
  protected override async readWallet(): Promise<Rows> {
    if (this.rows instanceof Error) throw this.rows;
    return this.rows;
  }
}

const RECHARGE =
  'Bank ReferenceNo: pay_TXUpcKc5pqAmZZ | Order ID: order_TXUpO8UmoxuGQp | Payment Gateway: RZ';
// Newest first, balances chaining: 1,500.00 → +15,000 → −90.36 → −5.90.
const PASSBOOK = [
  [
    '11 Sep, 2026 07:10 PM',
    '5650817040',
    '80156885583',
    'VAS',
    'WhatsApp Communication',
    'WhatsApp Communication charges',
    '- ₹ 5.90',
    '₹ 16,403.74',
  ],
  [
    '11 Sep, 2026 07:10 PM',
    '5650817040',
    '80156885583',
    'Freight Charges',
    'Freight Forward',
    'Forward charges applied',
    '- ₹ 90.36',
    '₹ 16,409.64',
  ],
  [
    '03 Sep, 2026 01:55 PM',
    'NA',
    'NA',
    'Recharge and Credit',
    'Recharge and Credit',
    RECHARGE,
    '+ ₹ 15,000.00',
    '₹ 16,500.00',
  ],
  [
    '02 Sep, 2026 10:00 AM',
    '4651931705',
    '14112364739585',
    'Freight Charges',
    'Freight Forward',
    'Forward charges applied',
    '- ₹ 100.00',
    '₹ 1,500.00',
  ],
];
const HISTORY = [['03 Sep, 2026', '856241788423700', '₹ 15000.00', 'Success', 'UPI', RECHARGE]];

const IMPORTED = {
  txnsNew: 3,
  txnsAlreadyHeld: 0,
  txnsMutated: 0,
  mutated: [],
  txnsMissing: 0,
  missing: [],
  incompleteHistory: 0,
  incomplete: [],
};

function makeSut(opts: {
  enabled?: boolean;
  writes?: boolean;
  openChallenge?: boolean;
  openError?: Error;
  rows?: Rows | Error;
  codTopUps?: Array<{
    reference: string;
    freightDeductedInr: { toFixed: (n: number) => string };
    receivedAt: Date;
  }>;
}) {
  const handle = {
    page: {},
    newPage: jest.fn(),
    close: jest.fn(async () => undefined),
  } as unknown as ShiprocketPortalHandle;
  const session = {
    open: jest.fn(async () => {
      if (opts.openError !== undefined) throw opts.openError;
      return handle;
    }),
  };
  const prisma = {
    client: {
      systemSetting: {
        findUnique: async ({ where }: { where: { key: string } }) => {
          if (where.key.endsWith('window_days')) return { valueInt: 90 };
          if (where.key.endsWith('writes_enabled')) return { valueBoolean: opts.writes ?? true };
          return { valueBoolean: opts.enabled ?? true };
        },
      },
      courierAccount: {
        findMany: async () => [{ id: 'acct-sr', label: 'Shiprocket - primary' }],
      },
      systemIssue: {
        findFirst: async () => (opts.openChallenge === true ? { id: 'x' } : null),
      },
      // Payouts that sent part of the COD to the wallet (Postpaid).
      courierSettlement: { findMany: async () => opts.codTopUps ?? [] },
    },
  };
  const importer = { importTransactions: jest.fn(async (_i: Record<string, unknown>) => IMPORTED) };
  const reconcile = {
    reconcileRecharges: jest.fn(async (..._a: unknown[]) => ({
      rechargesSeen: 1,
      newlySeen: 1,
      matched: 1,
      unrecorded: 0,
      amountMismatched: 0,
      lowBalance: 0,
    })),
    checkPaidButNeverArrived: jest.fn(async () => 0),
  };
  const audit = { log: jest.fn(async (_a: Record<string, unknown>) => 'a1') };
  const issues = {
    raise: jest.fn(async (_i: Record<string, unknown>) => ({ id: 'i', isNew: true })),
    resolveByKey: jest.fn(async () => 0),
  };
  const svc = new TestSync(
    prisma as unknown as PrismaService,
    session as unknown as ShiprocketPortalSessionService,
    importer as unknown as WalletImportService,
    reconcile as unknown as CourierWalletReconcileService,
    audit as unknown as AuditLogService,
    issues as unknown as SystemIssueService,
  );
  svc.rows = opts.rows ?? {
    passbookRows: PASSBOOK,
    usable: '16403.74',
    rechargeRows: HISTORY,
    ledgerRows: [],
  };
  return { svc, session, handle, importer, reconcile, audit, issues };
}

const raisedKeys = (issues: { raise: jest.Mock }): string[] =>
  issues.raise.mock.calls.map((c) => String((c[0] as { dedupeKey: string }).dedupeKey));

describe('ShiprocketWalletSyncService', () => {
  it('does nothing while switched off — and still records the run', async () => {
    const s = makeSut({ enabled: false });
    const out = await s.svc.sync('SCHEDULE');
    expect(out.skipped).toBe('DISABLED');
    expect(s.session.open).not.toHaveBeenCalled();
    expect(s.audit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'courier.shiprocket_wallet.synced' }),
    );
  });

  it('does not open a browser while a sign-in challenge is unresolved', async () => {
    const s = makeSut({ openChallenge: true });
    const out = await s.svc.sync('SCHEDULE');
    expect(out.accounts[0]?.outcome).toBe('SKIPPED');
    expect(s.session.open).not.toHaveBeenCalled();
  });

  it('imports the passbook as Shiprocket’s, matches the recharges, and closes the browser', async () => {
    const s = makeSut({});
    const out = await s.svc.sync('MANUAL');

    expect(out.accounts[0]).toMatchObject({ outcome: 'READ', passbookRows: 4, chainBreaks: 0 });
    const input = s.importer.importTransactions.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(input).toMatchObject({
      courierCode: 'shiprocket',
      courierAccountId: 'acct-sr',
      dryRun: false,
      totalsAgree: true,
      impliedClosingInr: '16403.74',
    });
    // The recharge is NOT a transaction: three movements, not four.
    expect((input['txns'] as unknown[]).length).toBe(3);
    expect(s.reconcile.reconcileRecharges).toHaveBeenCalledWith(
      'shiprocket',
      'acct-sr',
      'Shiprocket - primary',
      [
        expect.objectContaining({
          externalTxnId: '856241788423700',
          bankTxnRef: 'pay_TXUpcKc5pqAmZZ',
        }),
      ],
      expect.objectContaining({ balanceInr: '16403.74' }),
    );
    expect(s.reconcile.checkPaidButNeverArrived).toHaveBeenCalledTimes(1);
    expect(s.handle.close).toHaveBeenCalled();
  });

  it('REFUSES a passbook whose balances do not chain — nothing is stored', async () => {
    const s = makeSut({
      rows: {
        passbookRows: PASSBOOK.filter((_, i) => i !== 1), // a movement missing
        usable: '16403.74',
        rechargeRows: HISTORY,
        ledgerRows: [],
      },
    });
    const out = await s.svc.sync('SCHEDULE');
    expect(out.accounts[0]?.outcome).toBe('REFUSED');
    expect(s.importer.importTransactions).not.toHaveBeenCalled();
    expect(raisedKeys(s.issues)).toContain('shiprocket-wallet-chain:acct-sr');
  });

  it('with writes off it reads and reports — stores nothing, matches nothing', async () => {
    const s = makeSut({ writes: false });
    await s.svc.sync('SCHEDULE');
    expect(s.importer.importTransactions.mock.calls[0]?.[0]).toMatchObject({ dryRun: true });
    expect(s.reconcile.reconcileRecharges).not.toHaveBeenCalled();
    expect(s.reconcile.checkPaidButNeverArrived).not.toHaveBeenCalled();
  });

  it('a challenge at sign-in raises the issue that stops every website run', async () => {
    const s = makeSut({
      openError: new ShiprocketPortalChallengeError(
        'CAPTCHA',
        null,
        'https://app.shiprocket.in/newlogin',
      ),
    });
    const out = await s.svc.sync('SCHEDULE');
    expect(out.accounts[0]?.outcome).toBe('CHALLENGE');
    expect(raisedKeys(s.issues)).toContain('shiprocket-portal-challenge:acct-sr');
  });

  it('names a ledger credit that never reached the wallet', async () => {
    const s = makeSut({
      rows: {
        passbookRows: PASSBOOK,
        usable: '16403.74',
        rechargeRows: HISTORY,
        ledgerRows: [
          [
            '25 Aug, 2026',
            '25 Aug, 2026',
            'Other Wallet Credits',
            '₹ 0',
            '₹ 10100',
            'ShipSure Refunds Credited',
            '₹ -1',
          ],
        ],
      },
    });
    const out = await s.svc.sync('SCHEDULE');
    expect(out.accounts[0]?.ledger?.uncovered).toHaveLength(1);
    expect(raisedKeys(s.issues)).toContain('shiprocket-ledger-uncovered:acct-sr');
  });

  it('a read that fails says so, and still closes the browser', async () => {
    const s = makeSut({ rows: new Error('passbook: the table never finished drawing') });
    const out = await s.svc.sync('SCHEDULE');
    expect(out.accounts[0]?.outcome).toBe('FAILED');
    expect(raisedKeys(s.issues)).toContain('shiprocket-wallet-sync:acct-sr');
    expect(s.handle.close).toHaveBeenCalled();
    expect(s.audit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'courier.shiprocket_wallet.sync_failed' }),
    );
  });
});

describe('ShiprocketWalletSyncService — COD-funded wallet top-ups', () => {
  it('names a payout whose freight top-up never reached the wallet', async () => {
    const s = makeSut({
      codTopUps: [
        {
          reference: 'IN22625415423299',
          freightDeductedInr: { toFixed: () => '500.00' },
          receivedAt: new Date('2026-09-01T10:00:00Z'),
        },
      ],
    });
    await s.svc.sync('SCHEDULE', new Date('2026-09-11T10:00:00Z'));
    expect(raisedKeys(s.issues)).toContain('shiprocket-cod-topup-unseen:acct-sr');
  });

  it('gives a payout recorded in the last three days time to arrive', async () => {
    const s = makeSut({
      codTopUps: [
        {
          reference: 'IN22625415423299',
          freightDeductedInr: { toFixed: () => '500.00' },
          receivedAt: new Date('2026-09-10T10:00:00Z'),
        },
      ],
    });
    await s.svc.sync('SCHEDULE', new Date('2026-09-11T10:00:00Z'));
    expect(raisedKeys(s.issues)).not.toContain('shiprocket-cod-topup-unseen:acct-sr');
  });
});
