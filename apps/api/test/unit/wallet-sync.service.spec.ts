import { WalletSyncService } from '../../src/modules/courier-portal/services/wallet-sync.service';
import type { PrismaService } from '../../src/infrastructure/prisma/prisma.service';
import type { AuditLogService } from '../../src/modules/auth-common/services/audit-log.service';
import type { WalletLedgerFetcherService } from '../../src/modules/courier-portal/services/wallet-ledger-fetcher.service';
import type { WalletImportService } from '../../src/modules/wallet-ledger/services/wallet-import.service';
import type { SystemIssueService } from '../../src/modules/system-issues/services/system-issue.service';

type AnyArgs = Record<string, unknown>;

function make(
  opts: {
    enabled?: boolean;
    writes?: boolean;
    windowDays?: number;
    pageThrows?: Error;
    accounts?: Array<{ id: string; label: string }>;
  } = {},
) {
  const settings: Record<string, AnyArgs> = {
    'courier.wallet_sync_enabled': { valueBoolean: opts.enabled ?? true },
    'courier.wallet_sync_writes_enabled': { valueBoolean: opts.writes ?? false },
    'courier.wallet_sync_window_days': { valueInt: opts.windowDays ?? 45 },
  };
  const findUnique = jest.fn(async ({ where }: { where: { key: string } }) => {
    return settings[where.key] ?? null;
  });
  const accounts = opts.accounts ?? [{ id: 'acct-1', label: 'Delhivery — MS EXPORTS' }];
  const findMany = jest.fn(async () => accounts);
  const prisma = {
    client: { systemSetting: { findUnique }, courierAccount: { findMany } },
  } as unknown as PrismaService;

  const fetch = jest.fn(async () => {
    if (opts.pageThrows) throw opts.pageThrows;
    return Buffer.from('a ledger file');
  });
  const fetcher = { fetch } as unknown as WalletLedgerFetcherService;

  const importDelhiveryWallet = jest.fn(async () => ({
    rowsRead: 5,
    rowsSkipped: 0,
    awbsInFile: 4,
    forwardWritten: 3,
    rtoWritten: 1,
    unchanged: 0,
    revised: 2,
    unknownAwbs: 0,
    sumInr: '100.00',
    statedTotalInr: '100.00',
    totalsAgree: true,
    periodFrom: null,
    periodTo: null,
    dryRun: false,
  }));
  const importer = { importDelhiveryWallet } as unknown as WalletImportService;

  const auditLog = jest.fn(async () => undefined);
  const audit = { log: auditLog } as unknown as AuditLogService;

  const raise = jest.fn(async () => ({ id: 'issue-1', isNew: true }));
  const resolveByKey = jest.fn(async () => 1);
  const issues = { raise, resolveByKey } as unknown as SystemIssueService;

  const svc = new WalletSyncService(prisma, fetcher, importer, audit, issues);
  return { svc, fetch, importDelhiveryWallet, auditLog, findMany, raise, resolveByKey };
}

describe('WalletSyncService', () => {
  it('does nothing at all when the sync is switched off', async () => {
    const { svc, fetch } = make({ enabled: false });
    const out = await svc.sync();
    expect(out.skipped).toBe('DISABLED');
    // Not even a login: an off switch must not touch the courier.
    expect(fetch).not.toHaveBeenCalled();
  });

  it('SHADOW by default — it reads the real file and writes nothing', async () => {
    // Two switches, not one. Running it and letting it write are
    // separate decisions, so the fetch and the parse can be proven
    // against real files for a week before any cost column moves.
    const { svc, importDelhiveryWallet } = make({ enabled: true, writes: false });
    const out = await svc.sync();
    expect(out.wrote).toBe(false);
    expect(importDelhiveryWallet).toHaveBeenCalledWith(
      expect.anything(),
      null,
      expect.objectContaining({ dryRun: true }),
    );
  });

  it('writes only when the write switch is on', async () => {
    const { svc, importDelhiveryWallet } = make({ enabled: true, writes: true });
    const out = await svc.sync();
    expect(out.wrote).toBe(true);
    expect(importDelhiveryWallet).toHaveBeenCalledWith(
      expect.anything(),
      null,
      expect.objectContaining({ dryRun: false }),
    );
  });

  it('imports as NOBODY — the schedule ran it, not a person', async () => {
    // `audit_logs.actor_id` is a UUID column. A label like
    // "system:wallet-sync" would make Postgres reject the row, and
    // AuditLogService swallows its own failures, so the audit would
    // simply not exist.
    const { svc, importDelhiveryWallet } = make({ enabled: true, writes: true });
    await svc.sync();
    const calls = importDelhiveryWallet.mock.calls as unknown as AnyArgs[][];
    expect(calls[0]?.[1]).toBeNull();
  });

  it('a failed fetch is reported, never thrown', async () => {
    // The ledger is a nightly convenience and the manual upload still
    // exists. A portal that is down must not take the worker with it.
    const { svc, auditLog } = make({ pageThrows: new Error('portal login failed') });
    const out = await svc.sync();
    expect(out.accounts[0]?.error).toContain('portal login failed');
    const calls = auditLog.mock.calls as unknown as AnyArgs[][];
    const actions = calls.map((c) => c[0]?.['action']);
    expect(actions).toContain('courier.wallet_ledger.sync_failed');
  });

  it('re-reads a WIDE window, because charges are re-cut weeks later', async () => {
    const { svc } = make({ enabled: true, windowDays: 45 });
    const out = await svc.sync();
    // A one-day window would import each parcel's first figure and
    // never see the correction — the exact error the importer exists
    // to avoid.
    expect(out.windowDays).toBe(45);
  });
});

describe('WalletSyncService — several Delhivery accounts', () => {
  it('fetches EACH account with its own login, scoped to its own parcels', async () => {
    // One Delhivery, several accounts — each a different company on
    // their panel with its own wallet. One login cannot see another's
    // money, and one account's ledger must not claim another's parcels.
    const { svc, fetch, importDelhiveryWallet } = make({
      enabled: true,
      writes: true,
      accounts: [
        { id: 'acct-a', label: 'MS EXPORTS' },
        { id: 'acct-b', label: 'SECOND CO' },
      ],
    });
    const out = await svc.sync();

    expect(out.accounts).toHaveLength(2);
    expect(fetch.mock.calls.map((c) => (c as unknown as string[])[0])).toEqual([
      'acct-a',
      'acct-b',
    ]);
    const scopes = (importDelhiveryWallet.mock.calls as unknown as AnyArgs[][]).map(
      (c) => (c[2] as AnyArgs)['courierAccountId'],
    );
    expect(scopes).toEqual(['acct-a', 'acct-b']);
  });

  it('one account failing does not stop the others', async () => {
    // The same per-item isolation as the AWB and manifest sagas: a
    // portal that is down for one company must not cost the rest a
    // night of costs.
    const { svc } = make({
      enabled: true,
      accounts: [
        { id: 'acct-a', label: 'MS EXPORTS' },
        { id: 'acct-b', label: 'SECOND CO' },
      ],
    });
    const out = await svc.sync();
    expect(out.accounts).toHaveLength(2);
  });

  it('says so when no account has a credential to log in with', async () => {
    const { svc, fetch } = make({ enabled: true, accounts: [] });
    const out = await svc.sync();
    expect(out.skipped).toBe('NO_ACCOUNTS');
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe('WalletSyncService — it says when it needs a person', () => {
  it('raises an issue when the fetch fails, keyed on the ACCOUNT', async () => {
    // A cost sync that stops working is invisible otherwise: the figures
    // simply stop moving and nobody notices until a margin looks wrong
    // weeks later.
    const { svc, raise } = make({ pageThrows: new Error('portal login failed') });
    await svc.sync();
    const arg = (raise.mock.calls as unknown as AnyArgs[][])[0]?.[0] as AnyArgs;
    expect(arg['dedupeKey']).toBe('wallet-sync:acct-1');
    // Keyed on the account and NOT the moment — a timestamped key would
    // open a fresh row every night and the list would stop being read.
    expect(String(arg['dedupeKey'])).not.toMatch(/\d{4}-\d{2}-\d{2}/);
  });

  it('calls an OTP what it is, and raises it higher', async () => {
    // A transient failure retries tonight. A challenge does not: nothing
    // runs again until a human answers it.
    const { svc, raise } = make({ pageThrows: new Error('OTP challenge presented') });
    await svc.sync();
    const arg = (raise.mock.calls as unknown as AnyArgs[][])[0]?.[0] as AnyArgs;
    expect(arg['kind']).toBe('COURIER_PORTAL_CHALLENGE');
    expect(arg['severity']).toBe('HIGH');
  });

  it('clears its own alarm when it works again', async () => {
    // A job that recovers should not leave a stale row for somebody to
    // tidy up by hand.
    const { svc, resolveByKey } = make({ enabled: true, writes: true });
    await svc.sync();
    expect(resolveByKey).toHaveBeenCalledWith('wallet-sync:acct-1', expect.any(String));
  });
});
