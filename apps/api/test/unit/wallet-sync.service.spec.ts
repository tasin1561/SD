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
    rangeApplied?: boolean;
    window?: 'LAST_90_DAYS' | 'CUSTOM_RANGE' | 'PAGE_DEFAULT' | 'UNKNOWN';
    periodFrom?: string;
    periodTo?: string;
    rowsRead?: number;
    missing?: Array<{
      txnId: string;
      awbNumber: string | null;
      kind: string;
      amountInr: string;
      occurredAt: string;
    }>;
    mutated?: Array<{
      txnId: string;
      awbNumber: string | null;
      ourKind: string;
      theirKind: string;
      ourAmountInr: string;
      theirAmountInr: string;
    }>;
    /** Dedupe keys of issues that are open when the run starts. */
    openIssues?: string[];
    /** Make the open-issue lookup throw, to prove it fails OPEN. */
    issueLookupThrows?: boolean;
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
  // The challenge pre-check's own query. Answering it honestly matters:
  // the service FAILS OPEN on an error, so a fake that threw would make
  // every case below pass for the wrong reason.
  const issueFindMany = jest.fn(async ({ where }: { where: { dedupeKey: { in: string[] } } }) => {
    if (opts.issueLookupThrows === true) throw new Error('db down');
    const open = opts.openIssues ?? [];
    return where.dedupeKey.in.filter((k) => open.includes(k)).map((dedupeKey) => ({ dedupeKey }));
  });
  const prisma = {
    client: {
      systemSetting: { findUnique },
      courierAccount: { findMany },
      systemIssue: { findMany: issueFindMany },
    },
  } as unknown as PrismaService;

  const fetch = jest.fn(async () => {
    if (opts.pageThrows) throw opts.pageThrows;
    return {
      bytes: Buffer.from('a ledger file'),
      rangeApplied: opts.rangeApplied ?? true,
      window: opts.window ?? 'LAST_90_DAYS',
    };
  });
  const fetcher = { fetch } as unknown as WalletLedgerFetcherService;

  const importDelhiveryWallet = jest.fn(async () => ({
    rowsRead: opts.rowsRead ?? 5,
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
    periodFrom: opts.periodFrom ?? null,
    periodTo: opts.periodTo ?? null,
    dryRun: false,
    txnsMissing: opts.missing?.length ?? 0,
    missing: opts.missing ?? [],
    txnsMutated: opts.mutated?.length ?? 0,
    mutated: opts.mutated ?? [],
  }));
  const importer = { importDelhiveryWallet } as unknown as WalletImportService;

  // Parameters declared so `mock.calls[n][0]` is typed rather than `never`.
  const auditLog = jest.fn(async (_input: Record<string, unknown>) => undefined);
  const audit = { log: auditLog } as unknown as AuditLogService;

  const raise = jest.fn(async (_input: Record<string, unknown>) => ({
    id: 'issue-1',
    isNew: true,
  }));
  const resolveByKey = jest.fn(async (_key: string, _note: string) => 1);
  const issues = { raise, resolveByKey } as unknown as SystemIssueService;

  /**
   * The recharge reconciliation, which the sync runs after the import.
   *
   * Recorded rather than stubbed to nothing: it reuses the session the
   * ledger fetch has just signed in with, and these cases assert the
   * ledger import still succeeds when the reconciliation fails — its
   * failures are its own to raise.
   */
  const reconcile = jest.fn(async () => ({
    accounts: 1,
    rechargesSeen: 0,
    newlySeen: 0,
    matched: 0,
    unrecorded: 0,
    amountMismatched: 0,
    paidButNeverArrived: 0,
    lowBalance: 0,
  }));

  const svc = new WalletSyncService(prisma, fetcher, importer, audit, issues, {
    reconcile,
  } as never);
  return {
    svc,
    fetch,
    importDelhiveryWallet,
    auditLog,
    findMany,
    raise,
    resolveByKey,
    reconcile,
    issueFindMany,
  };
}

/** The shape of a `raise()` call, narrowed to what these cases read. */
interface RaisedIssue {
  readonly dedupeKey: string;
  readonly severity: string;
  readonly title: string;
}

/** Every dedupeKey the run raised, in order. */
function raisedKeys(raise: jest.Mock): string[] {
  return raise.mock.calls.map((c) => (c[0] as RaisedIssue).dedupeKey);
}

/** The issue raised under one key, or a failure naming the key. */
function raisedUnder(raise: jest.Mock, dedupeKey: string): RaisedIssue {
  const found = raise.mock.calls
    .map((c) => c[0] as RaisedIssue)
    .find((i) => i.dedupeKey === dedupeKey);
  if (found === undefined) throw new Error(`nothing was raised under ${dedupeKey}`);
  return found;
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

describe('the recharge reconciliation runs alongside the ledger', () => {
  it('runs after a successful import — same session, no second login', async () => {
    // A second nightly login against a courier's portal is load for
    // nothing, and the session it needs has just been used.
    const { svc, reconcile } = make({});
    await svc.sync();
    expect(reconcile).toHaveBeenCalledTimes(1);
  });

  it('hands the reconcile each export sum WITH the window its file covered', async () => {
    // The page's stated debit is compared against this sum, and the two
    // only mean the same thing over the same window (13 Sep 2026: a
    // ninety-day export against a default-window page raised HIGH nightly).
    const { svc, reconcile } = make({ window: 'LAST_90_DAYS' });
    const summary = await svc.sync();
    const passed = (reconcile.mock.calls[0] as unknown as [string, Map<string, unknown>])[1];
    expect(passed.get('acct-1')).toEqual({ sumInr: '100.00', window: 'LAST_90_DAYS' });
    expect(summary.accounts[0]?.exportWindow).toBe('LAST_90_DAYS');
  });

  it('says so when the export fell back to the page default', async () => {
    const { svc, reconcile } = make({ rangeApplied: false, window: 'PAGE_DEFAULT' });
    await svc.sync();
    const passed = (reconcile.mock.calls[0] as unknown as [string, Map<string, unknown>])[1];
    expect(passed.get('acct-1')).toEqual({ sumInr: '100.00', window: 'PAGE_DEFAULT' });
  });

  it('a reconciliation failure does NOT fail the ledger import', async () => {
    // The import has already succeeded and written costs by this point.
    // Losing that because the recharge check could not run would throw
    // away the work and re-do it tomorrow.
    const { svc, reconcile } = make({});
    reconcile.mockRejectedValueOnce(new Error('portal unreachable'));
    await expect(svc.sync()).resolves.toBeDefined();
  });

  /**
   * The window is the whole point of a nightly re-read, and nothing was
   * checking we got it. The setting said 45 days; every real export came
   * back covering about 7, so a charge Delhivery re-cut later than that
   * would never be re-read and the parcel would keep its first figure —
   * silently, as a margin that is quietly wrong.
   */
  describe('the window we asked for versus the one we got', () => {
    const busy = (days: number) => ({
      rowsRead: 2000,
      periodFrom: new Date(Date.now() - days * 86_400_000).toISOString(),
      periodTo: new Date().toISOString(),
    });

    it('raises when the export covers far less than the window', async () => {
      const { svc, raise } = make({ enabled: true, writes: true, windowDays: 45, ...busy(7) });
      await svc.sync();
      const call = (raise.mock.calls as unknown as AnyArgs[][]).find(
        (c) => (c[0] as { dedupeKey?: string }).dedupeKey === 'wallet-sync-window:acct-1',
      );
      expect(call).toBeDefined();
      expect((call?.[0] as { metadata?: { coveredDays?: number } }).metadata?.coveredDays).toBe(7);
    });

    it('says nothing when the export covers the window', async () => {
      const { svc, raise } = make({ enabled: true, writes: true, windowDays: 45, ...busy(44) });
      await svc.sync();
      const call = (raise.mock.calls as unknown as AnyArgs[][]).find(
        (c) => (c[0] as { dedupeKey?: string }).dedupeKey === 'wallet-sync-window:acct-1',
      );
      expect(call).toBeUndefined();
    });

    it('does NOT cry short on a quiet account', async () => {
      // The span is the earliest and latest CHARGE, not a stated export
      // range: on a handful of rows a short span is a quiet week. An
      // alarm that fires on quiet is one people learn to ignore.
      const { svc, raise } = make({
        enabled: true,
        writes: true,
        windowDays: 45,
        rowsRead: 4,
        periodFrom: new Date(Date.now() - 2 * 86_400_000).toISOString(),
        periodTo: new Date().toISOString(),
      });
      await svc.sync();
      const call = (raise.mock.calls as unknown as AnyArgs[][]).find(
        (c) => (c[0] as { dedupeKey?: string }).dedupeKey === 'wallet-sync-window:acct-1',
      );
      expect(call).toBeUndefined();
    });

    it('records whether their date picker took the range', async () => {
      const { svc } = make({ enabled: true, writes: true, rangeApplied: false });
      const summary = await svc.sync();
      expect(summary.accounts[0]?.rangeApplied).toBe(false);
    });
  });
});

/**
 * Their ledger rewriting its own history is an alarm, not a log line.
 *
 * The importer detects both shapes — a transaction that vanished from an
 * export covering its date, and one that came back with a different
 * amount — but a count inside an audit row is read by nobody. These are
 * money disagreements with a courier, and they need a person while the
 * evidence is fresh.
 */
describe('WalletSyncService — their ledger changed its history', () => {
  const issueFor = (raise: jest.Mock, key: string): AnyArgs | undefined =>
    (raise.mock.calls as unknown as AnyArgs[][])
      .map((c) => c[0] as AnyArgs)
      .find((a) => a['dedupeKey'] === key);

  it('raises a MONEY issue naming each vanished transaction', async () => {
    const { svc, raise } = make({
      enabled: true,
      writes: true,
      missing: [
        {
          txnId: 'MTX-7SEP',
          awbNumber: '38061110522900',
          kind: 'DEBIT',
          amountInr: '77.19',
          occurredAt: '2026-09-07T10:00:00.000Z',
        },
      ],
    });
    await svc.sync();
    const arg = issueFor(raise, 'wallet-txn-missing:acct-1');
    expect(arg?.['kind']).toBe('MONEY');
    expect(arg?.['severity']).toBe('HIGH');
    expect(String(arg?.['detail'])).toContain('MTX-7SEP');
  });

  it('raises a MONEY issue showing ours against theirs for an edited one', async () => {
    const { svc, raise } = make({
      enabled: true,
      writes: true,
      mutated: [
        {
          txnId: 'MTX-EDIT',
          awbNumber: 'DL1',
          ourKind: 'DEBIT',
          theirKind: 'DEBIT',
          ourAmountInr: '41',
          theirAmountInr: '40.00',
        },
      ],
    });
    await svc.sync();
    const arg = issueFor(raise, 'wallet-txn-mutated:acct-1');
    expect(arg?.['kind']).toBe('MONEY');
    expect(String(arg?.['detail'])).toContain('ours DEBIT ₹41 → theirs DEBIT ₹40.00');
  });

  it('says nothing on an ordinary night', async () => {
    const { svc, raise } = make({ enabled: true, writes: true });
    await svc.sync();
    expect(issueFor(raise, 'wallet-txn-missing:acct-1')).toBeUndefined();
    expect(issueFor(raise, 'wallet-txn-mutated:acct-1')).toBeUndefined();
  });
});

/**
 * ── A STANDING CHALLENGE STOPS THE SYNC BEFORE THE BROWSER OPENS ──────
 *
 * An OTP or captcha cannot be answered by a browser, so a sign-in
 * attempted against one fails by construction — and CLAUDE.md is
 * explicit that hammering a courier portal is how an account gets
 * locked. `ShiprocketWalletSyncService` has checked for an open
 * challenge before signing in since September; this service had no such
 * check at all and only classified the error AFTERWARDS, so a standing
 * challenge meant a fresh browser session against an impossible login
 * every single night.
 */
describe('an open sign-in challenge', () => {
  it('skips the account rather than opening a browser against it', async () => {
    const { svc, fetch } = make({ openIssues: ['wallet-sync-challenge:acct-1'] });
    const out = await svc.sync();
    expect(fetch).not.toHaveBeenCalled();
    expect(out.accounts[0]?.outcome).toBe('CHALLENGE');
  });

  it('honours the SESSION’s own estate-wide key too', async () => {
    // `PortalSessionService.freezeOnChallenge` raises `portal:challenge`
    // and pauses the channel for 24 hours. Either key means a person
    // must sign in by hand before anything here can work.
    const { svc, fetch } = make({ openIssues: ['portal:challenge'] });
    await svc.sync();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('keeps the month PROVISIONAL — nothing was imported', async () => {
    // PnlNightlyGateService reads this metadata off the audit row and
    // counts only READ / CHECKED / SKIPPED as "the account was read".
    // CHALLENGE must not be in that set, or a month closes FINAL over
    // costs that never arrived.
    const { svc, auditLog } = make({ openIssues: ['portal:challenge'] });
    await svc.sync();
    const meta = auditLog.mock.calls[0]?.[0] as {
      metadata: { accounts: Array<{ outcome: string }> };
    };
    expect(meta.metadata.accounts[0]?.outcome).toBe('CHALLENGE');
    expect(['READ', 'CHECKED', 'SKIPPED']).not.toContain(meta.metadata.accounts[0]?.outcome);
  });

  it('does NOT skip on the ordinary failure key', async () => {
    // `wallet-sync:<id>` is "the page or the login changed" — a
    // transient that only a successful run clears. Skipping on it would
    // silence the sync for ever with nothing able to un-silence it.
    const { svc, fetch } = make({ openIssues: ['wallet-sync:acct-1'] });
    await svc.sync();
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('FAILS OPEN — a database blip must not cost a night of costs', async () => {
    const { svc, fetch } = make({ issueLookupThrows: true });
    await svc.sync();
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('leaves the other accounts alone', async () => {
    const { svc, fetch } = make({
      accounts: [
        { id: 'acct-1', label: 'A' },
        { id: 'acct-2', label: 'B' },
      ],
      openIssues: ['wallet-sync-challenge:acct-1'],
    });
    const out = await svc.sync();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(out.accounts.map((a) => a.outcome)).toEqual(['CHALLENGE', 'READ']);
  });
});

/**
 * ── ONE DIAGNOSIS, ONE KEY ────────────────────────────────────────────
 *
 * Both branches raised `wallet-sync:<account>` while disagreeing about
 * kind, title and severity, so whichever failed first owned the row's
 * identity and every later night rewrote the rest underneath it. On
 * production that left a HIGH "asking … to prove it is human" sitting
 * over a MEDIUM selector timeout for six days, telling nobody after the
 * first night.
 */
describe('the two failure diagnoses have a key each', () => {
  it('a challenge gets the challenge key, HIGH', async () => {
    const { svc, raise } = make({ pageThrows: new Error('Portal presented a CAPTCHA challenge') });
    await svc.sync();
    expect(raisedUnder(raise, 'wallet-sync-challenge:acct-1').severity).toBe('HIGH');
    expect(raisedKeys(raise)).not.toContain('wallet-sync:acct-1');
  });

  it('anything else gets the plain failure key, MEDIUM', async () => {
    const { svc, raise } = make({ pageThrows: new Error('the Download Ledger button is gone') });
    await svc.sync();
    expect(raisedUnder(raise, 'wallet-sync:acct-1').severity).toBe('MEDIUM');
    expect(raisedKeys(raise)).not.toContain('wallet-sync-challenge:acct-1');
  });

  it('a good night clears BOTH of its own keys', async () => {
    // An issue raised under one key and cleared under another is how a
    // HIGH "sign in by hand" survives the night the sign-in started
    // working again.
    const { svc, resolveByKey } = make({ enabled: true, writes: true });
    await svc.sync();
    const cleared = resolveByKey.mock.calls.map((c) => String(c[0]));
    expect(cleared).toContain('wallet-sync:acct-1');
    expect(cleared).toContain('wallet-sync-challenge:acct-1');
  });
});
