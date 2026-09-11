import { Injectable, Logger } from '@nestjs/common';
import { ActorType } from '@skydrop/db';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { AuditLogService } from '../../auth-common/services/audit-log.service';
import { SystemIssueService } from '../../system-issues/services/system-issue.service';
import { SystemIssueKind, SystemIssueSeverity } from '@skydrop/db';
import { WalletLedgerFetcherService } from './wallet-ledger-fetcher.service';
import {
  WalletImportService,
  type WalletImportResult,
} from '../../wallet-ledger/services/wallet-import.service';
import { CourierWalletReconcileService } from './courier-wallet-reconcile.service';

const SETTING_ENABLED = 'courier.wallet_sync_enabled';
const SETTING_WRITE = 'courier.wallet_sync_writes_enabled';
const SETTING_WINDOW_DAYS = 'courier.wallet_sync_window_days';

/** Days of slack before a short export counts as short. */
const COVERAGE_SLACK_DAYS = 3;
/** Below this, a short span means a quiet week rather than a short window. */
const MIN_ROWS_TO_JUDGE_COVERAGE = 50;

/**
 * How many days a file spans, from its earliest charge to its latest.
 *
 * ISO strings rather than Dates because that is what the importer
 * reports, and re-parsing them here keeps the comparison next to the
 * thing being compared.
 */
function spanDays(fromIso: string | null, toIso: string | null): number | null {
  if (fromIso === null || toIso === null) return null;
  const a = Date.parse(fromIso);
  const b = Date.parse(toIso);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.round((b - a) / 86_400_000));
}

/** One account's fetch. Several Delhivery accounts means several. */
export interface WalletSyncAccountResult {
  readonly courierAccountId: string;
  readonly label: string;
  readonly fileBytes: number | null;
  readonly result: WalletImportResult | null;
  readonly error: string | null;
  /** Whether their date picker took the window we asked for. */
  readonly rangeApplied: boolean | null;
  /** How many days the file we got back actually spans. */
  readonly coveredDays: number | null;
}

export interface WalletSyncSummary {
  readonly ranAt: string;
  readonly skipped: 'DISABLED' | 'NO_ACCOUNTS' | null;
  /** False while the sync only reports. See the class comment. */
  readonly wrote: boolean;
  readonly windowDays: number;
  readonly accounts: readonly WalletSyncAccountResult[];
}

/**
 * Fetching the wallet ledger by itself, nightly.
 *
 * ── WHY A BROWSER ────────────────────────────────────────────────────
 * Delhivery has no billing API. Their documented surface offers a cost
 * CALCULATOR — "what does a parcel of this shape cost" — which can
 * never answer "what was this one billed", and cannot see a revision.
 * The wallet ledger is the only record of what actually left, and it
 * exists only in their panel.
 *
 * ── A ROLLING WINDOW, NOT YESTERDAY ──────────────────────────────────
 * A charge is re-cut weeks after the parcel moved. Fetching only the
 * last day would import each parcel's FIRST figure and never see the
 * correction, which is the exact error the whole importer exists to
 * avoid. So it re-fetches a wide window every night and re-states it.
 * That is cheap because the importer overwrites rather than skips.
 *
 * ── SHADOW BY DEFAULT, AND THE TWO SWITCHES ARE SEPARATE ─────────────
 * `wallet_sync_enabled` runs it; `wallet_sync_writes_enabled` lets it
 * touch the cost columns. Two switches rather than one so the fetch and
 * the parse can be proven against real files for a week while writing
 * nothing — the same shape the portal work already uses, and the reason
 * a login or a page change shows up as a report rather than as wrong
 * money in the P&L.
 */
@Injectable()
export class WalletSyncService {
  private readonly logger = new Logger(WalletSyncService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly fetcher: WalletLedgerFetcherService,
    private readonly importer: WalletImportService,
    private readonly audit: AuditLogService,
    private readonly issues: SystemIssueService,
    private readonly walletReconcile: CourierWalletReconcileService,
  ) {}

  async sync(now: Date = new Date()): Promise<WalletSyncSummary> {
    const [enabled, writes, windowDays] = await Promise.all([
      this.flag(SETTING_ENABLED, false),
      this.flag(SETTING_WRITE, false),
      this.int(SETTING_WINDOW_DAYS, 45),
    ]);

    const base = {
      ranAt: now.toISOString(),
      wrote: writes,
      windowDays,
      accounts: [] as WalletSyncAccountResult[],
    };
    if (!enabled) return { ...base, skipped: 'DISABLED' as const, wrote: false };

    // EVERY active Delhivery account, because each is a different
    // company on their panel with its own wallet. One login cannot see
    // another's money.
    const accounts = await this.prisma.client.courierAccount.findMany({
      where: {
        isActive: true,
        deletedAt: null,
        courier: { code: 'delhivery' },
        credential: { isNot: null },
      },
      select: { id: true, label: true },
      orderBy: { label: 'asc' },
    });
    if (accounts.length === 0) return { ...base, skipped: 'NO_ACCOUNTS' as const };

    const from = new Date(now.getTime() - windowDays * 86_400_000);
    const results: WalletSyncAccountResult[] = [];

    for (const account of accounts) {
      try {
        const { bytes: file, rangeApplied } = await this.fetcher.fetch(account.id, from, now);
        // dryRun is the inverse of the write switch: in SHADOW it parses
        // the real file and reports exactly what it WOULD change.
        const result = await this.importer.importDelhiveryWallet(file, null, {
          dryRun: !writes,
          // Scoped, so one account's ledger cannot claim another's
          // parcels and "not ours" keeps meaning something.
          courierAccountId: account.id,
        });
        const coveredDays = spanDays(result.periodFrom, result.periodTo);
        results.push({
          courierAccountId: account.id,
          label: account.label,
          fileBytes: file.length,
          result,
          error: null,
          rangeApplied,
          coveredDays,
        });
        await this.reportCoverage(account, windowDays, coveredDays, rangeApplied, result);

        /*
          THEY EDITED A TRANSACTION WE ALREADY HOLD.

          A courier corrects a charge by adding a reversal, never by
          rewriting history, so this should never fire — which is exactly
          why it is worth an alarm when it does. Our copy is NOT rewritten
          (the importer reports rather than applies); this tells a person
          so the difference is put to the courier while it is fresh.
        */
        if (result.txnsMutated > 0) {
          await this.issues.raise({
            kind: SystemIssueKind.MONEY,
            severity: SystemIssueSeverity.HIGH,
            title: `${result.txnsMutated} transaction(s) changed in ${account.label}'s ledger`,
            detail:
              `Their latest export carries ${result.txnsMutated} transaction(s) under ids we ` +
              'already hold, with a different amount, direction or waybill. They correct a ' +
              'charge by adding a reversal, not by editing one, so this is history being ' +
              'rewritten.\n\n' +
              result.mutated
                .slice(0, 10)
                .map(
                  (m) =>
                    `${m.txnId} · ${m.awbNumber ?? 'no AWB'} · ours ${m.ourKind} ₹${m.ourAmountInr} → theirs ${m.theirKind} ₹${m.theirAmountInr}`,
                )
                .join('\n') +
              '\n\nOur recorded copy has been kept unchanged. Ask Delhivery in writing which is ' +
              'correct.',
            source: 'WalletSyncService',
            dedupeKey: `wallet-txn-mutated:${account.id}`,
            metadata: {
              courierAccountId: account.id,
              label: account.label,
              count: result.txnsMutated,
              mutated: result.mutated.slice(0, 25).map((m) => ({ ...m })),
            },
          });
        }

        /*
          THEIR LEDGER DROPPED SOMETHING WE HOLD.

          Raised here, not in the importer, because this is where the
          issue service already lives and where the account is known by
          name. The importer has already stamped the rows and stopped
          netting them; this is the part that tells a person, because a
          charge vanishing from a courier's own history is a question to
          put to the courier, in writing, while the dates are fresh.
        */
        if (result.txnsMissing > 0) {
          const total = result.missing.reduce(
            (a, m) => a + (m.kind === 'DEBIT' ? 1 : -1) * Number(m.amountInr),
            0,
          );
          await this.issues.raise({
            kind: SystemIssueKind.MONEY,
            severity: SystemIssueSeverity.HIGH,
            title: `${result.txnsMissing} transaction(s) vanished from ${account.label}'s ledger`,
            detail:
              `Their latest export covers these dates but no longer contains ` +
              `${result.txnsMissing} transaction(s) we recorded earlier (net ₹${total.toFixed(2)}). ` +
              'Not a changed amount — the rows are gone.\n\n' +
              result.missing
                .slice(0, 10)
                .map(
                  (m) =>
                    `${m.txnId} · ${m.awbNumber ?? 'no AWB'} · ${m.kind} ₹${m.amountInr} · ${m.occurredAt.slice(0, 10)}`,
                )
                .join('\n') +
              '\n\nThey are kept on our side as evidence and no longer counted in parcel costs, ' +
              'because the current export still balances to the live wallet without them. Ask ' +
              'Delhivery in writing why they were removed.',
            source: 'WalletSyncService',
            dedupeKey: `wallet-txn-missing:${account.id}`,
            metadata: {
              courierAccountId: account.id,
              label: account.label,
              count: result.txnsMissing,
              missing: result.missing.slice(0, 25).map((m) => ({ ...m })),
            },
          });
        }
        /*
          ONE OF OUR PARCELS NETS BELOW ZERO.

          Nobody is paid to carry a parcel, so this means our ledger is
          missing one of its debits — a charge dated before we held its
          history, or one that has since vanished. The importer refused to
          stamp it (a negative cost would be subtracted from the P&L);
          this is the half that tells somebody which parcels to look at.
        */
        if (result.incompleteHistory > 0) {
          await this.issues.raise({
            kind: SystemIssueKind.MONEY,
            severity: SystemIssueSeverity.HIGH,
            title: `${result.incompleteHistory} of our parcels net below zero in ${account.label}'s ledger`,
            detail:
              `Their charges and refunds for ${result.incompleteHistory} of our parcels add up ` +
              'to LESS than nothing, so a debit is missing from what we hold. Their cost was not ' +
              'changed.\n\n' +
              result.incomplete
                .slice(0, 10)
                .map((p) => `${p.awbNumber} · net ₹${p.netInr}`)
                .join('\n') +
              '\n\nFind the original charge on their panel; if it predates our ledger, record ' +
              'the cost by hand on the order.',
            source: 'WalletSyncService',
            dedupeKey: `wallet-negative-net:${account.id}`,
            metadata: {
              courierAccountId: account.id,
              label: account.label,
              count: result.incompleteHistory,
              incomplete: result.incomplete.slice(0, 25).map((p) => ({ ...p })),
            },
          });
        }
        // It worked, so clear its own alarm. A job that starts working
        // again should not leave a stale row for a person to tidy.
        await this.issues.resolveByKey(
          `wallet-sync:${account.id}`,
          'The sync completed on its own.',
        );
      } catch (err) {
        // One account's portal being down must not stop the others —
        // the same per-item failure isolation as the AWB and manifest
        // sagas. Its costs are simply re-read tomorrow.
        const message = err instanceof Error ? err.message : String(err);
        this.logger.error(
          { err: message, courierAccountId: account.id, label: account.label },
          'Wallet ledger sync failed for one account; continuing with the rest',
        );
        results.push({
          courierAccountId: account.id,
          label: account.label,
          fileBytes: null,
          result: null,
          error: message,
          rangeApplied: null,
          coveredDays: null,
        });

        // Say so where somebody will see it. A cost sync that stops
        // working is invisible otherwise: the figures simply stop
        // moving, and nobody notices until a margin looks wrong weeks
        // later.
        const challenge = /otp|captcha|challenge/i.test(message);
        await this.issues.raise({
          kind: challenge
            ? SystemIssueKind.COURIER_PORTAL_CHALLENGE
            : SystemIssueKind.COURIER_COST_SYNC,
          // A one-off overnight failure is not urgent — the window is
          // rolling and tomorrow re-reads it. A CHALLENGE is, because
          // nothing will run again until a person answers it.
          severity: challenge ? SystemIssueSeverity.HIGH : SystemIssueSeverity.MEDIUM,
          title: challenge
            ? `Delhivery is asking ${account.label} to prove it is human`
            : `Could not read what Delhivery charged ${account.label}`,
          detail: challenge
            ? 'The portal presented an OTP or captcha, so the nightly cost sync cannot log in. ' +
              'Sign in by hand once to clear it. Until then no courier costs are being recorded ' +
              'for this account and the P&L will report its margin as uncovered.'
            : `The nightly wallet sync failed: ${message}\n\n` +
              'Costs for this account are not updating. It retries tonight; if this keeps ' +
              'recurring the portal has probably changed and the login needs looking at. ' +
              'Meanwhile the ledger can be uploaded by hand on the Delhivery page.',
          source: 'WalletSyncService',
          // The ACCOUNT, not the moment — a key carrying a timestamp
          // would open a fresh row every night.
          dedupeKey: `wallet-sync:${account.id}`,
          metadata: { courierAccountId: account.id, label: account.label, error: message },
        });
      }
    }

    const summary: WalletSyncSummary = { ...base, skipped: null, accounts: results };
    const failed = results.filter((r) => r.error !== null).length;
    await this.audit.log({
      actorType: ActorType.SYSTEM,
      actorId: null,
      action:
        failed === results.length
          ? 'courier.wallet_ledger.sync_failed'
          : 'courier.wallet_ledger.synced',
      entityType: 'courier',
      // A UUID column. The code goes in metadata (see the importer).
      entityId: null,
      severity: failed > 0 ? 'HIGH' : writes ? 'MEDIUM' : 'LOW',
      metadata: { courierCode: 'delhivery', ...summary, accounts: results.map((r) => ({ ...r })) },
    });
    this.logger.log({ accounts: results.length, failed, wrote: writes }, 'Wallet ledger sync done');

    /*
      AND THE OTHER HALF OF THE WALLET.

      The ledger above says what the courier CHARGED us. This says what
      we PUT IN, and whether every rupee of it left one of our own bank
      accounts — the prepaid float is our capital sitting on somebody
      else's system, and until now nothing checked either direction.

      Run here rather than on its own cron because it needs the same
      signed-in session that has just been used, and a second nightly
      login against a courier's portal is load for nothing. Its failures
      are its own — it raises them itself — so they never fail the
      ledger import that has already succeeded.
    */
    try {
      // What each account's export summed to, so the reconcile can hold
      // it against the figure their own page states for the same
      // window. Two independent readings of one ledger: if the file is
      // short, its sum falls below theirs.
      const exportSums = new Map<string, string>();
      for (const r of results) {
        if (r.result !== null) exportSums.set(r.courierAccountId, r.result.sumInr);
      }
      const recon = await this.walletReconcile.reconcile('delhivery', exportSums);
      this.logger.log(recon, 'Courier wallet reconciliation done');
    } catch (err) {
      this.logger.error(
        { err: err instanceof Error ? err.message : String(err) },
        'Courier wallet reconciliation could not run',
      );
    }
    return summary;
  }

  /**
   * Did we get the window we asked for?
   *
   * `wallet_sync_window_days` is not a preference — it is the whole
   * reason this re-reads a wide range every night instead of fetching
   * yesterday. Delhivery re-cuts a charge weeks after the parcel moved,
   * so an export that only ever covers the last few days imports each
   * parcel's FIRST figure and never sees the correction: precisely the
   * error the importer exists to avoid, arriving silently, as costs
   * that look settled and are not.
   *
   * Nothing was comparing the two. The setting said 45 days and every
   * file that came back covered about 7, because their date picker is
   * driven best-effort and the export falls back to the page default —
   * a failure the page object anticipated in a comment and then
   * discarded the evidence for.
   *
   * Checked against the FILE rather than against the picker, so it
   * fires whichever way the window was lost: a picker we could not
   * drive, a picker we drove that they ignored, or a cap they applied
   * server-side. `rangeApplied` only says which of those it was.
   *
   * Guarded on row count because the span is the earliest and latest
   * CHARGE in the file, not a stated export range: on an account with a
   * handful of rows a short span means a quiet week, not a short
   * window, and an alarm that fires on quiet is one people learn to
   * ignore.
   */
  private async reportCoverage(
    account: { id: string; label: string },
    windowDays: number,
    coveredDays: number | null,
    rangeApplied: boolean,
    result: WalletImportResult,
  ): Promise<void> {
    const key = `wallet-sync-window:${account.id}`;
    const enoughRows = result.rowsRead >= MIN_ROWS_TO_JUDGE_COVERAGE;
    const short =
      coveredDays !== null && enoughRows && coveredDays + COVERAGE_SLACK_DAYS < windowDays;

    if (!short) {
      await this.issues.resolveByKey(key, 'The export covered the window we asked for.');
      return;
    }

    await this.issues.raise({
      kind: SystemIssueKind.COURIER_COST_SYNC,
      // Not urgent — today's costs ARE being recorded. What is lost is
      // the revision to an older one, which shows up as a margin that
      // is quietly wrong rather than as anything stopping.
      severity: SystemIssueSeverity.MEDIUM,
      title: `Only ${coveredDays} days of ledger came back for ${account.label}, not ${windowDays}`,
      detail:
        `The nightly sync asks for ${windowDays} days so a charge re-cut weeks later gets ` +
        `re-read. The export that came back spans ${coveredDays} days ` +
        `(${result.periodFrom ?? '?'} to ${result.periodTo ?? '?'}), so a revision older than ` +
        `that will never be picked up and those parcels keep the first figure they were given.\n\n` +
        (rangeApplied
          ? 'Their date picker accepted the range, so the cap is theirs — the export may have a ' +
            'maximum span. Exporting a longer range by hand from the Finances page and uploading ' +
            'it on the Delhivery page is the way to catch up.'
          : 'Their date picker could not be driven, so the export fell back to whatever range ' +
            'the page defaults to. The picker has probably changed shape and needs looking at.'),
      source: 'WalletSyncService',
      dedupeKey: key,
      metadata: {
        courierAccountId: account.id,
        label: account.label,
        windowDays,
        coveredDays,
        rangeApplied,
        periodFrom: result.periodFrom,
        periodTo: result.periodTo,
        rowsRead: result.rowsRead,
      },
    });
  }

  private async flag(key: string, fallback: boolean): Promise<boolean> {
    const row = await this.prisma.client.systemSetting.findUnique({
      where: { key },
      select: { valueBoolean: true },
    });
    return row?.valueBoolean ?? fallback;
  }

  private async int(key: string, fallback: number): Promise<number> {
    const row = await this.prisma.client.systemSetting.findUnique({
      where: { key },
      select: { valueInt: true },
    });
    return row?.valueInt ?? fallback;
  }
}
