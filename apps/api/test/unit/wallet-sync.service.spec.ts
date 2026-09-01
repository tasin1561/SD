import { WalletSyncService } from '../../src/modules/courier-portal/services/wallet-sync.service';
import type { PrismaService } from '../../src/infrastructure/prisma/prisma.service';
import type { AuditLogService } from '../../src/modules/auth-common/services/audit-log.service';
import type { WalletLedgerFetcherService } from '../../src/modules/courier-portal/services/wallet-ledger-fetcher.service';
import type { WalletImportService } from '../../src/modules/wallet-ledger/services/wallet-import.service';

type AnyArgs = Record<string, unknown>;

function make(
  opts: {
    enabled?: boolean;
    writes?: boolean;
    windowDays?: number;
    pageThrows?: Error;
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
  const prisma = {
    client: { systemSetting: { findUnique } },
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

  const svc = new WalletSyncService(prisma, fetcher, importer, audit);
  return { svc, fetch, importDelhiveryWallet, auditLog };
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
    expect(out.error).toContain('portal login failed');
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
